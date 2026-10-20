import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from '@modelcontextprotocol/sdk/client/stdio.js';

const BUILT_CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist/cli.js');

export interface LiveFixture {
  readonly gatewayUrl: string;
  readonly apiKey: string;
  readonly organizationId: number;
  readonly productId: number;
}

export interface LiveMcp {
  readonly call: (name: string, args?: Record<string, unknown>) => Promise<string>;
  readonly close: () => Promise<void>;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. The live journeys need the staging MCP fixture (see tests/live/README.md).`
    );
  }
  return value;
}

export function liveFixture(): LiveFixture {
  return {
    gatewayUrl: requireEnv('VISIBILIO_LIVE_GATEWAY_URL'),
    apiKey: requireEnv('VISIBILIO_LIVE_API_KEY'),
    organizationId: Number(requireEnv('VISIBILIO_LIVE_ORGANIZATION_ID')),
    productId: Number(requireEnv('VISIBILIO_LIVE_PRODUCT_ID')),
  };
}

function textOf(content: unknown): string {
  return (Array.isArray(content) ? content : [])
    .filter((part): part is { type: 'text'; text: string } => part?.type === 'text')
    .map((part) => part.text)
    .join('\n');
}

export async function connectLiveMcp(fixture: LiveFixture): Promise<LiveMcp> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [BUILT_CLI],
    env: {
      ...getDefaultEnvironment(),
      VISIBILIO_API_KEY: fixture.apiKey,
      VISIBILIO_GATEWAY_URL: fixture.gatewayUrl,
    },
    stderr: 'inherit',
  });
  const client = new Client({ name: 'visibilio-mcp-live-journeys', version: '1.0.0' });
  await client.connect(transport);
  return {
    call: async (name, args = {}) => {
      const result = await client.callTool({ name, arguments: args });
      const text = textOf(result.content);
      if (result.isError) {
        throw new Error(`${name} failed: ${text}`);
      }
      return text;
    },
    close: () => client.close(),
  };
}
