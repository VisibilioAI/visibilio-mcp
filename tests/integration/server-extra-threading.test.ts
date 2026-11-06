import { describe, it, expect, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildServer } from '../../src/server.js';
import type { Settings } from '../../src/config.js';

const settings: Settings = {
  gatewayUrl: 'https://gateway.test',
  credential: 'vsk_valid',
  timeoutMs: 900_000,
};

const ME = {
  user: { id: 42, email: 'owner@example.com', name: 'Owner Example' },
  organizations: [{ id: 158, name: 'Visibilio', role: 'owner' }],
  default_organization_id: 158,
};

function respond(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response;
}

/** Answers auth, then hangs on GET /products until its own signal aborts — so a client cancel is observable. */
function slowProductsGateway(capture: { signal?: AbortSignal }): typeof fetch {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    if (path === '/api/v2/auth/me') return respond(200, ME);
    if (path === '/api/v2/products') {
      return new Promise<Response>((_resolve, reject) => {
        capture.signal = init?.signal ?? undefined;
        init?.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('aborted', 'AbortError')),
          { once: true }
        );
      });
    }
    return respond(404, { error: 'not_found' });
  }) as unknown as typeof fetch;
}

async function connectedClient(fetchImpl: typeof fetch): Promise<Client> {
  const built = await buildServer({ settings, fetch: fetchImpl });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await built.server.connect(serverTransport);
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await client.connect(clientTransport);
  return client;
}

describe('server threads the SDK extra end-to-end (guards the request-scope wrap)', () => {
  it('a cancelled tool call aborts the in-flight gateway fetch', async () => {
    const capture: { signal?: AbortSignal } = {};
    const client = await connectedClient(slowProductsGateway(capture));

    const controller = new AbortController();
    const call = client
      .callTool({ name: 'list_products', arguments: {} }, undefined, {
        signal: controller.signal,
      })
      .catch((err: unknown) => err);

    await vi.waitFor(() => expect(capture.signal).toBeDefined());
    controller.abort();
    await call;

    expect(capture.signal?.aborted).toBe(true);
  });
});
