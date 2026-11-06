import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { ServerNotification, ServerRequest } from '@modelcontextprotocol/sdk/types.js';
import { McpAuth, type AuthContext } from './auth.js';
import { VisibilioClient } from './client.js';
import { McpSession, type SessionContext } from './session.js';
import { loadSettings, type Settings } from './config.js';
import { allTools } from './tools/index.js';
import { allResources } from './resources/index.js';
import { toCallToolResult } from './tools/_define.js';
import { runInRequestScope, type RequestScope } from './request-scope.js';

type ToolExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

function makeProgressReporter(extra: ToolExtra, progressToken: string | number): () => void {
  let progress = 0;
  return () => {
    progress += 1;
    void extra
      .sendNotification({ method: 'notifications/progress', params: { progressToken, progress } })
      .catch(() => undefined);
  };
}

export function buildRequestScope(extra: ToolExtra): RequestScope {
  const progressToken = extra._meta?.progressToken;
  return {
    signal: extra.signal,
    reportProgress:
      progressToken === undefined ? undefined : makeProgressReporter(extra, progressToken),
  };
}

export const SERVER_NAME = '@visibilio/mcp';
export const SERVER_VERSION = '0.2.9';

export interface BuildServerOptions {
  settings?: Settings;
  fetch?: typeof fetch;
  contextFor?: (
    auth: AuthContext,
    client: VisibilioClient
  ) => Promise<SessionContext | undefined> | SessionContext | undefined;
  onContextChange?: (
    auth: AuthContext,
    client: VisibilioClient,
    context: SessionContext
  ) => Promise<void> | void;
}

export interface BuiltServer {
  server: McpServer;
  session: McpSession;
}

export async function buildServer(options: BuildServerOptions = {}): Promise<BuiltServer> {
  const settings = options.settings ?? loadSettings();
  const fetchImpl = options.fetch ?? globalThis.fetch;

  const auth = new McpAuth({
    credential: settings.credential,
    gatewayUrl: settings.gatewayUrl,
    fetch: fetchImpl,
  });
  const context = await auth.resolve();

  const client = new VisibilioClient({
    gatewayUrl: settings.gatewayUrl,
    credential: settings.credential,
    timeoutMs: settings.timeoutMs,
    fetch: fetchImpl,
  });

  const session = new McpSession(context, client, {
    initialContext: await options.contextFor?.(context, client),
    onContextChange: (next) => options.onContextChange?.(context, client, next),
  });
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions: [
        'Visibilio is an AI content platform. Everything is scoped to an organization and a product.',
        'Start with whoami; if no product is active, call list_products and set_active_product (or pass product_id).',
        'Content tools create and edit content items; publishing tools push them to connected channels and hubs.',
      ].join(' '),
    }
  );

  for (const tool of allTools) {
    const inputSchema =
      Object.keys(tool.inputSchema).length === 0 ? z.object({}).strict() : tool.inputSchema;
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema,
        annotations: { ...tool.annotations, title: tool.title },
      },
      (args: Record<string, unknown>, extra: ToolExtra) =>
        runInRequestScope(buildRequestScope(extra), async () =>
          toCallToolResult(await tool.handler(args ?? {}, session))
        )
    );
  }

  for (const resource of allResources) {
    server.registerResource(
      resource.name,
      resource.uri,
      { title: resource.title, description: resource.description, mimeType: resource.mimeType },
      async (uri) => ({
        contents: [
          { uri: uri.href, mimeType: resource.mimeType, text: await resource.read(session) },
        ],
      })
    );
  }

  return { server, session };
}
