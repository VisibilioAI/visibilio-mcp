import { describe, it, expect, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildServer } from '../../src/server.js';
import { allTools } from '../../src/tools/index.js';

function publishAtSchema() {
  const tool = allTools.find((t) => t.name === 'schedule_content_item');
  if (!tool) throw new Error('schedule_content_item is not registered');
  const schema = tool.inputSchema.publish_at;
  if (!schema) throw new Error('schedule_content_item has no publish_at input');
  return schema;
}

const ME = {
  user: { id: 42, email: 'owner@example.com', name: 'Owner Example' },
  organizations: [{ id: 7, name: 'Primary Org', role: 'owner' }],
  default_organization_id: 7,
};

function gateway() {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${(init?.method ?? 'GET').toUpperCase()} ${new URL(url).pathname}`;
    const body = key === 'GET /api/v2/auth/me' ? ME : { data: {} };
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
  const client = new Client({ name: 'publish-at-test', version: '0.0.0' });
  await client.connect(ct);
  return client;
}

async function errorText(
  client: Client,
  args: Record<string, unknown>
): Promise<string> {
  try {
    const result = (await client.callTool({ name: 'schedule_content_item', arguments: args })) as {
      isError?: boolean;
      content?: Array<{ text?: string }>;
    };
    if (result.isError) return result.content?.map((c) => c.text ?? '').join(' ') ?? '';
    return '';
  } catch (err) {
    return (err as Error).message;
  }
}

describe('schedule_content_item.publish_at enforces an ISO-8601 datetime', () => {
  it('rejects a non-ISO date (the reporter "22.10.2026" format)', () => {
    expect(publishAtSchema().safeParse('22.10.2026').success).toBe(false);
  });

  it('rejects a space-separated datetime (not ISO-8601)', () => {
    expect(publishAtSchema().safeParse('2026-10-20 09:00').success).toBe(false);
  });

  it('rejects a date without a time component', () => {
    expect(publishAtSchema().safeParse('2026-10-20').success).toBe(false);
  });

  it('accepts the documented UTC form', () => {
    expect(publishAtSchema().safeParse('2026-10-20T09:00:00Z').success).toBe(true);
  });

  it('accepts a numeric-offset datetime', () => {
    expect(publishAtSchema().safeParse('2026-10-20T09:00:00+02:00').success).toBe(true);
  });

  it('accepts a naive-local datetime (paired with options.timezone)', () => {
    expect(publishAtSchema().safeParse('2026-10-20T09:00:00').success).toBe(true);
  });
});

describe('schedule_content_item rejects a bad publish_at at the protocol layer', () => {
  it('is rejected with an error naming publish_at, before reaching the gateway', async () => {
    const client = await connectedClient();
    const text = await errorText(client, {
      content_item_id: 1,
      channel_id: 2,
      publish_at: '22.10.2026',
    });
    expect(text, 'a bad publish_at should be rejected').not.toBe('');
    expect(text).toContain('publish_at');
  });
});
