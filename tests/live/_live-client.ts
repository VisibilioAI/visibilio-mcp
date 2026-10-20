import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist');
const BUILT_CLI = path.join(DIST, 'cli.js');
const BUILT_HTTP = path.join(DIST, 'http.js');
const HEALTH_TIMEOUT_MS = 20_000;

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

export interface LiveHttpServer {
  readonly mcpUrl: URL;
  readonly stop: () => Promise<void>;
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
  return liveMcpOver(transport);
}

export async function connectLiveHttpMcp(
  server: LiveHttpServer,
  fixture: LiveFixture
): Promise<LiveMcp> {
  const transport = new StreamableHTTPClientTransport(server.mcpUrl, {
    requestInit: { headers: { Authorization: `Bearer ${fixture.apiKey}` } },
  });
  return liveMcpOver(transport);
}

export async function startLiveHttpServer(fixture: LiveFixture): Promise<LiveHttpServer> {
  const port = await freePort();
  const child = spawn(process.execPath, [BUILT_HTTP], {
    env: { ...process.env, PORT: String(port), VISIBILIO_GATEWAY_URL: fixture.gatewayUrl },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  await waitUntilHealthy(baseUrl, child);
  return {
    mcpUrl: new URL(`${baseUrl}/mcp`),
    stop: async () => {
      if (child.exitCode !== null) return;
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      await exited;
    },
  };
}

async function liveMcpOver(
  transport: StdioClientTransport | StreamableHTTPClientTransport
): Promise<LiveMcp> {
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

async function freePort(): Promise<number> {
  const probe = net.createServer().listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const address = probe.address();
  probe.close();
  await once(probe, 'close');
  if (address === null || typeof address === 'string') {
    throw new Error('Could not find a free port for the HTTP server.');
  }
  return address.port;
}

async function waitUntilHealthy(baseUrl: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`The HTTP server exited with code ${child.exitCode} before it was healthy.`);
    }
    const healthy = await fetch(`${baseUrl}/health`).then(
      (response) => response.ok,
      () => false
    );
    if (healthy) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`The HTTP server at ${baseUrl} was not healthy within ${HEALTH_TIMEOUT_MS} ms.`);
}
