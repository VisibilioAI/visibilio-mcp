import { describe, expect, it, vi } from 'vitest';
import { VisibilioClient } from '../../src/client.js';

interface CapturedCall {
  url: string;
  init?: RequestInit;
}

function buildClient(opts: { internalApiKey?: string }) {
  const calls: CapturedCall[] = [];
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
    backendUrl: 'https://backend.test',
    gatewayUrl: 'https://gateway.test',
    userApiKey: 'vsk_mock',
    internalApiKey: opts.internalApiKey,
    fetch: fetchImpl as unknown as typeof fetch,
  });
  return { client, calls };
}

const tenant = {
  'X-User-Id': '42',
  'X-Organization-Id': '7',
} as const;

describe('VisibilioClient backend headers', () => {
  it('sends X-API-Key header (NOT X-Internal-Api-Key) when internalApiKey is configured', async () => {
    const { client, calls } = buildClient({ internalApiKey: 'internal_secret' });
    await client.backendPost('/api/v2/workflow/start', { foo: 'bar' }, tenant);
    const headers = (calls[0]!.init!.headers ?? {}) as Record<string, string>;
    expect(headers['X-API-Key']).toBe('internal_secret');
    expect(headers['X-Internal-Api-Key']).toBeUndefined();
  });

  it('omits the API-Key header entirely when internalApiKey is not set', async () => {
    const { client, calls } = buildClient({});
    await client.backendPost('/api/v2/workflow/start', { foo: 'bar' }, tenant);
    const headers = (calls[0]!.init!.headers ?? {}) as Record<string, string>;
    expect(headers['X-API-Key']).toBeUndefined();
    expect(headers['X-Internal-Api-Key']).toBeUndefined();
  });

  it('sends X-User-Id and X-Organization-Id alongside the API key', async () => {
    const { client, calls } = buildClient({ internalApiKey: 'k' });
    await client.backendGet('/api/v2/knowledge/7/audience_data', tenant);
    const headers = (calls[0]!.init!.headers ?? {}) as Record<string, string>;
    expect(headers['X-User-Id']).toBe('42');
    expect(headers['X-Organization-Id']).toBe('7');
    expect(headers['X-API-Key']).toBe('k');
  });
});
