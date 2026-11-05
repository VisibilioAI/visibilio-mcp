import { describe, it, expect, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildServer } from '../../src/server.js';
import { allTools } from '../../src/tools/index.js';

const ME = {
  user: { id: 42, email: 'owner@example.com', name: 'Owner Example' },
  organizations: [{ id: 7, name: 'Primary Org', role: 'owner' }],
  default_organization_id: 7,
};

function gateway() {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    const key = `${(init?.method ?? 'GET').toUpperCase()} ${path}`;
    const body =
      key === 'GET /api/v2/auth/me'
        ? ME
        : path === '/api/v2/organizations/7/product-stats'
          ? { data: { products: [] } }
          : { data: [] };
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify(body),
      json: async () => body,
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

async function connectedClient(): Promise<Client> {
  const { server } = await buildServer({
    settings: { gatewayUrl: 'https://gateway.test', credential: 'vsk_test', timeoutMs: 30_000 },
    fetch: gateway(),
  });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: 'no-arg-test', version: '0.0.0' });
  await client.connect(ct);
  return client;
}

function noArgToolNames(): string[] {
  return allTools.filter((t) => Object.keys(t.inputSchema).length === 0).map((t) => t.name);
}

async function rejectionText(client: Client, name: string): Promise<string> {
  try {
    const result = (await client.callTool({ name, arguments: { bogus: 1 } })) as {
      isError?: boolean;
      content?: Array<{ text?: string }>;
    };
    if (result.isError) return result.content?.map((c) => c.text ?? '').join(' ') ?? '';
    return '';
  } catch (err) {
    return (err as Error).message;
  }
}

describe('no-arg tools reject unknown arguments (#1007.11)', () => {
  it('enumerates the five documented no-arg tools', () => {
    expect([...noArgToolNames()].sort()).toEqual(
      ['get_product_stats', 'list_channels', 'list_organizations', 'list_products', 'whoami'].sort()
    );
  });

  it.each(noArgToolNames())('%s rejects an unexpected key, naming it', async (name) => {
    const client = await connectedClient();
    const text = await rejectionText(client, name);
    expect(text.toLowerCase(), `${name} should reject {bogus:1}`).toContain('bogus');
  });

  it('whoami still accepts a valid empty-argument call', async () => {
    const client = await connectedClient();
    const result = (await client.callTool({ name: 'whoami', arguments: {} })) as {
      isError?: boolean;
      content?: Array<{ text?: string }>;
    };
    expect(result.isError ?? false).toBe(false);
    expect(result.content?.map((c) => c.text ?? '').join(' ')).toContain('owner@example.com');
  });
});
