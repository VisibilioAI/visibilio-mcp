import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { McpAuth } from './auth.js';
import { VisibilioClient } from './client.js';
import { McpSession } from './session.js';
import { loadSettings, type Settings } from './config.js';
import { allTools } from './tools/index.js';
import { allResources } from './resources/index.js';

const SERVER_NAME = '@visibilio/mcp';
const SERVER_VERSION = '0.1.0';

export interface BuildServerOptions {
  settings?: Settings;
  fetch?: typeof fetch;
}

export async function buildServer(options: BuildServerOptions = {}): Promise<{
  server: Server;
  session: McpSession;
}> {
  const settings = options.settings ?? loadSettings();
  const fetchImpl = options.fetch ?? globalThis.fetch;

  const auth = new McpAuth({
    apiKey: settings.apiKey,
    backendUrl: settings.backendUrl,
    fetch: fetchImpl,
  });
  const ctx = await auth.resolve();

  const client = new VisibilioClient({
    backendUrl: settings.backendUrl,
    gatewayUrl: settings.gatewayUrl,
    userApiKey: settings.apiKey,
    internalApiKey: settings.internalApiKey,
    timeoutMs: settings.timeoutMs,
    fetch: fetchImpl,
  });

  const session = new McpSession(ctx, client);
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {}, resources: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: allTools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = allTools.find((t) => t.name === request.params.name);
    if (!tool) {
      throw new Error(`Unknown tool: ${request.params.name}`);
    }
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    const text = await tool.handler(args, session);
    return {
      content: [{ type: 'text', text }],
    };
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: allResources.map((r) => ({
      uri: r.uri,
      name: r.name,
      description: r.description,
      mimeType: r.mimeType,
    })),
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const resource = allResources.find((r) => r.uri === request.params.uri);
    if (!resource) {
      throw new Error(`Unknown resource: ${request.params.uri}`);
    }
    const result = await resource.read(session);
    return { contents: [result] };
  });

  return { server, session };
}
