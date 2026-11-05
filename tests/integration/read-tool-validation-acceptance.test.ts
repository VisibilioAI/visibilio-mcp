import { describe, it, expect, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildServer } from '../../src/server.js';

const ME = {
  user: { id: 42, email: 'owner@example.com', name: 'Owner Example' },
  organizations: [{ id: 7, name: 'Primary Org', role: 'owner' }],
  default_organization_id: 7,
};

function gateway() {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${(init?.method ?? 'GET').toUpperCase()} ${new URL(url).pathname}`;
    const body = key === 'GET /api/v2/auth/me' ? ME : { data: [] };
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
  const client = new Client({ name: 'acceptance', version: '0.0.0' });
  await client.connect(ct);
  return client;
}

async function errorText(
  client: Client,
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  try {
    const result = (await client.callTool({ name, arguments: args })) as {
      isError?: boolean;
      content?: Array<{ text?: string }>;
    };
    if (result.isError) return result.content?.map((c) => c.text ?? '').join(' ') ?? '';
    return '';
  } catch (err) {
    return (err as Error).message;
  }
}

// Acceptance guards — the fixes land in steps 1-8; these lock the reporter's exact cases at the
// protocol boundary (the production path the SDK validates), proving each is rejected with the
// field named rather than a 500 or a silent wrong answer.
describe('reporter cases are rejected with the offending field named (meta#1013)', () => {
  const CASES: ReadonlyArray<readonly [string, Record<string, unknown>, string]> = [
    ['get_operation_overview', { period_hours: 1000000000 }, 'period_hours'],
    ['get_operation_overview', { period_hours: -1 }, 'period_hours'],
    ['list_hub_publications', { hub_id: 1, limit: -1 }, 'limit'],
    ['get_published_feed', { from: '22.10.2026' }, 'from'],
    ['list_notifications', { offset: -1 }, 'offset'],
    ['list_schedules', { status: 'bogus' }, 'status'],
  ];

  it.each(CASES)('%s with a bad argument is rejected naming the field', async (name, args, field) => {
    const client = await connectedClient();
    const text = await errorText(client, name, args);
    expect(text, `${name} should be rejected`).not.toBe('');
    expect(text, `${name} rejection should name ${field}`).toContain(field);
  });
});
