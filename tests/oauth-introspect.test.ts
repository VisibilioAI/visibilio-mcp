import { afterEach, describe, expect, it, vi } from 'vitest';
import { McpAuth, AuthenticationError, _clearIntrospectionCacheForTests } from '../src/auth.js';

const baseOptions = {
  backendUrl: 'https://backend.test',
  gatewayUrl: 'https://gateway.test',
  oauthClientId: 'vco_mcp',
  oauthClientSecret: 'vcs_secret',
};

function fetchOk(body: Record<string, unknown>) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => body,
  }) as unknown as typeof fetch;
}

function fetchStatus(status: number, body: Record<string, unknown> = {}) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: async () => body,
  }) as unknown as typeof fetch;
}

function activeIntrospection(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    active: true,
    sub: '42',
    user_id: 42,
    organization_id: 7,
    client_id: 'vco_test',
    scope: 'mcp:read mcp:write',
    exp: Math.floor(Date.now() / 1000) + 3600,
    token_type: 'Bearer',
    ...overrides,
  };
}

afterEach(() => {
  _clearIntrospectionCacheForTests();
  vi.restoreAllMocks();
});

describe('OAuth token resolution', () => {
  it('resolves vat_* via /api/v2/oauth/introspect with Basic auth', async () => {
    const fetchImpl = fetchOk(activeIntrospection());
    const auth = new McpAuth({ ...baseOptions, apiKey: 'vat_abcdef', fetch: fetchImpl });
    const ctx = await auth.resolve();
    expect(ctx.userId).toBe(42);
    expect(ctx.organizationId).toBe(7);
    expect(ctx.scopes).toEqual(['mcp:read', 'mcp:write']);

    const fn = fetchImpl as unknown as ReturnType<typeof vi.fn>;
    const [url, init] = fn.mock.calls[0]!;
    expect(url).toBe('https://gateway.test/api/v2/oauth/introspect');
    expect((init as RequestInit).method).toBe('POST');
    const headers = (init as RequestInit).headers as Record<string, string>;
    const authHeader = headers.Authorization ?? '';
    expect(authHeader).toMatch(/^Basic /);
    const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
    expect(decoded).toBe('vco_mcp:vcs_secret');
    expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(String((init as RequestInit).body)).toContain('token=vat_abcdef');
  });

  it('caches introspection result per token (60s TTL by default)', async () => {
    const fetchImpl = fetchOk(activeIntrospection());
    const a1 = new McpAuth({ ...baseOptions, apiKey: 'vat_cache', fetch: fetchImpl });
    await a1.resolve();
    const a2 = new McpAuth({ ...baseOptions, apiKey: 'vat_cache', fetch: fetchImpl });
    await a2.resolve();
    const a3 = new McpAuth({ ...baseOptions, apiKey: 'vat_cache', fetch: fetchImpl });
    await a3.resolve();
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  it('does not cache different tokens together', async () => {
    const fetchImpl = fetchOk(activeIntrospection());
    await new McpAuth({ ...baseOptions, apiKey: 'vat_a', fetch: fetchImpl }).resolve();
    await new McpAuth({ ...baseOptions, apiKey: 'vat_b', fetch: fetchImpl }).resolve();
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });

  it('throws AuthenticationError when the token is inactive', async () => {
    const fetchImpl = fetchOk({ active: false });
    const auth = new McpAuth({ ...baseOptions, apiKey: 'vat_dead', fetch: fetchImpl });
    await expect(auth.resolve()).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('throws AuthenticationError on 401 from introspect', async () => {
    const fetchImpl = fetchStatus(401);
    const auth = new McpAuth({ ...baseOptions, apiKey: 'vat_x', fetch: fetchImpl });
    await expect(auth.resolve()).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('does not cache inactive tokens (re-fetches on retry)', async () => {
    const inactive = fetchOk({ active: false });
    const auth1 = new McpAuth({ ...baseOptions, apiKey: 'vat_revoked', fetch: inactive });
    await expect(auth1.resolve()).rejects.toBeInstanceOf(AuthenticationError);
    const auth2 = new McpAuth({ ...baseOptions, apiKey: 'vat_revoked', fetch: inactive });
    await expect(auth2.resolve()).rejects.toBeInstanceOf(AuthenticationError);
    expect((inactive as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });

  it('rejects vat_* when oauth client credentials are missing', async () => {
    const fetchImpl = fetchOk(activeIntrospection());
    const auth = new McpAuth({
      apiKey: 'vat_x',
      backendUrl: 'https://backend.test',
      gatewayUrl: 'https://gateway.test',
      fetch: fetchImpl,
    });
    await expect(auth.resolve()).rejects.toThrow(/VISIBILIO_OAUTH_CLIENT/);
  });

  it('rejects unknown token formats', async () => {
    const auth = new McpAuth({
      ...baseOptions,
      apiKey: 'something_else_xyz',
      fetch: fetchOk({}),
    });
    await expect(auth.resolve()).rejects.toThrow(/Unknown token format/);
  });

  it('still routes vsk_* through the resolve-key endpoint', async () => {
    const fetchImpl = fetchOk({
      user_id: 1,
      organization_id: 2,
      default_project_id: null,
      subscription_tier: 'free',
      scopes: ['mcp:read'],
    });
    const auth = new McpAuth({ ...baseOptions, apiKey: 'vsk_legacy', fetch: fetchImpl });
    const ctx = await auth.resolve();
    expect(ctx.userId).toBe(1);
    const fn = fetchImpl as unknown as ReturnType<typeof vi.fn>;
    expect(fn.mock.calls[0]![0]).toBe('https://backend.test/api/v2/auth/resolve-key');
  });
});
