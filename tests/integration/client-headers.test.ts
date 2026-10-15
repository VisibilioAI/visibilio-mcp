import { describe, expect, it, vi } from 'vitest';
import { VisibilioClient } from '../../src/client.js';

function buildClient() {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify({}),
      json: async () => ({}),
    } as unknown as Response;
  });
  const client = new VisibilioClient({
    gatewayUrl: 'https://gateway.test',
    credential: 'vsk_mock',
    fetch: fetchImpl as unknown as typeof fetch,
  });
  return { client, calls };
}

describe('VisibilioClient per-request headers', () => {
  it('forwards caller-supplied headers (e.g. X-Product-ID) onto the outgoing request', async () => {
    const { client, calls } = buildClient();
    await client.post('/api/v2/workflow/start', { user_request: 'x' }, undefined, {
      'X-Product-ID': '9',
    });
    const headers = (calls[0]!.init!.headers ?? {}) as Record<string, string>;
    expect(headers['X-Product-ID']).toBe('9');
    expect(headers['Authorization']).toBe('Bearer vsk_mock');
  });

  // Regression guard — already passes; locks in that no X-Product-ID leaks when the caller supplies none.
  it('sends no X-Product-ID when the caller supplies no extra headers', async () => {
    const { client, calls } = buildClient();
    await client.post('/api/v2/workflow/start', { user_request: 'x' });
    const headers = (calls[0]!.init!.headers ?? {}) as Record<string, string>;
    expect(headers['X-Product-ID']).toBeUndefined();
  });
});
