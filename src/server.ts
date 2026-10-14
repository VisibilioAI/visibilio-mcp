import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpAuth, type AuthContext } from './auth.js';
import { VisibilioClient } from './client.js';
import { McpSession, type SessionContext } from './session.js';
import { loadSettings, type Settings } from './config.js';
import { allTools } from './tools/index.js';
import { allResources } from './resources/index.js';
import { ToolError, toCallToolResult } from './tools/_define.js';

export const SERVER_NAME = '@visibilio/mcp';
export const SERVER_VERSION = '0.2.5';

export interface BuildServerOptions {
  settings?: Settings;
  fetch?: typeof fetch;
  contextFor?: (auth: AuthContext) => SessionContext | undefined;
  onContextChange?: (auth: AuthContext, context: SessionContext) => void;
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
    initialContext: options.contextFor?.(context),
    onContextChange: (next) => options.onContextChange?.(context, next),
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
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
      },
      async (args: Record<string, unknown>) => {
        try {
          return toCallToolResult(await tool.handler(args ?? {}, session));
        } catch (err) {
          if (err instanceof ToolError) {
            return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
          }
          throw err;
        }
      }
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
