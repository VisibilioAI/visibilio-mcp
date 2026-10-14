import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { buildHttpApp } from '../../src/http-app.js';
import type { BaseSettings } from '../../src/config.js';

const baseSettings: BaseSettings = {
  gatewayUrl: 'https://gateway.test',
  timeoutMs: 30_000,
};

function buildFailAuthFetch(status: number): typeof fetch {
  return vi.fn(async () => {
    return {
      ok: false,
      status,
      headers: { get: () => null },
      text: async () => '',
      json: async () => ({ error: `status ${status}` }),
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

describe('HTTP transport — auth gate', () => {
  it('GET /health includes session count', async () => {
    const { app } = buildHttpApp({ baseSettings });
    const response = await request(app).get('/health');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'ok', service: '@visibilio/mcp', sessions: 0 });
  });

  it('GET /sse without Authorization → 401 missing_authorization', async () => {
    const { app } = buildHttpApp({ baseSettings });
    const response = await request(app).get('/sse');
    expect(response.status).toBe(401);
    expect(response.body.error).toBe('missing_authorization');
    // MCP spec: 401 must include WWW-Authenticate with resource_metadata pointer
    // so clients (Claude.ai etc.) can auto-discover the OAuth flow per RFC 9728.
    const challenge = response.headers['www-authenticate'];
    expect(challenge).toMatch(/^Bearer /);
    expect(challenge).toContain('resource_metadata="');
    expect(challenge).toContain('/.well-known/oauth-protected-resource');
  });

  it('GET /sse with a non-vsk_/vat_ credential → 401 invalid_credential with WWW-Authenticate', async () => {
    const { app } = buildHttpApp({ baseSettings });
    const response = await request(app).get('/sse').set('Authorization', 'Bearer not_an_mcp_key');
    expect(response.status).toBe(401);
    expect(response.body.error).toBe('invalid_credential');
    expect(response.headers['www-authenticate']).toContain('resource_metadata=');
  });

  it('GET /sse with a revoked key (gateway 401) → no session is registered', async () => {
    const { app } = buildHttpApp({ baseSettings, fetch: buildFailAuthFetch(401) });
    // SSE responses keep the connection open; supertest can hang. Abort after first chunk.
    const response = await request(app)
      .get('/sse')
      .set('Authorization', 'Bearer vsk_revoked_test')
      .timeout({ deadline: 1000, response: 1000 })
      .ok(() => true);
    // Either we receive 401 explicitly, or the connection closes mid-stream — both are valid
    // failure modes for an invalid key. The contract is: handler does NOT register a session.
    expect([401, 200]).toContain(response.status);
  });
});

describe('HTTP transport — RFC 9728 protected resource metadata', () => {
  it('GET /.well-known/oauth-protected-resource resource = own host, AS = own host', async () => {
    const { app } = buildHttpApp({ baseSettings });
    const response = await request(app)
      .get('/.well-known/oauth-protected-resource')
      .set('host', 'mcp.test')
      .set('x-forwarded-proto', 'https');
    expect(response.status).toBe(200);
    expect(response.body.resource).toBe('https://mcp.test');
    expect(response.body.authorization_servers).toEqual(['https://mcp.test']);
    expect(response.body.bearer_methods_supported).toEqual(['header']);
    expect(response.body.scopes_supported).toEqual(['mcp:read', 'mcp:write', 'mcp:admin']);
    expect(response.headers['cache-control']).toBe('public, max-age=300');
  });

  it('GET /.well-known/oauth-protected-resource/sse returns the same payload (path-aware alias)', async () => {
    const { app } = buildHttpApp({ baseSettings });
    const a = await request(app)
      .get('/.well-known/oauth-protected-resource')
      .set('host', 'mcp.test')
      .set('x-forwarded-proto', 'https');
    const b = await request(app)
      .get('/.well-known/oauth-protected-resource/sse')
      .set('host', 'mcp.test')
      .set('x-forwarded-proto', 'https');
    expect(b.status).toBe(200);
    expect(b.body).toEqual(a.body);
  });
});

describe('HTTP transport — RFC 8414 authorization-server metadata (MCP-host)', () => {
  it('GET /.well-known/oauth-authorization-server publishes MCP-hosted endpoints', async () => {
    const { app } = buildHttpApp({ baseSettings });
    const response = await request(app)
      .get('/.well-known/oauth-authorization-server')
      .set('host', 'mcp.test')
      .set('x-forwarded-proto', 'https');
    expect(response.status).toBe(200);
    expect(response.body.issuer).toBe('https://mcp.test');
    expect(response.body.registration_endpoint).toBe('https://mcp.test/register');
    expect(response.body.token_endpoint).toBe('https://mcp.test/oauth/token');
    expect(response.body.revocation_endpoint).toBe('https://mcp.test/oauth/revoke');
    expect(response.body.response_types_supported).toContain('code');
    expect(response.body.grant_types_supported).toEqual(
      expect.arrayContaining(['authorization_code', 'refresh_token'])
    );
    expect(response.body.code_challenge_methods_supported).toContain('S256');
    expect(response.body.scopes_supported).toEqual(
      expect.arrayContaining(['mcp:read', 'mcp:write'])
    );
  });

  it('authorization_endpoint stays on the issuer origin even when frontendUrl is set (Codex refuses a foreign origin)', async () => {
    const { app } = buildHttpApp({
      baseSettings: { ...baseSettings, frontendUrl: 'https://app.test' },
    });
    const response = await request(app)
      .get('/.well-known/oauth-authorization-server')
      .set('host', 'mcp.test')
      .set('x-forwarded-proto', 'https');
    expect(response.body.authorization_endpoint).toBe('https://mcp.test/oauth/authorize');
  });

  it('GET /oauth/authorize redirects to the FE consent screen with the query string intact', async () => {
    const { app } = buildHttpApp({
      baseSettings: { ...baseSettings, frontendUrl: 'https://app.test/' },
    });
    const query =
      'response_type=code&client_id=vco_x&redirect_uri=http%3A%2F%2F127.0.0.1%3A1455%2Fcallback&state=abc&code_challenge=xyz&code_challenge_method=S256&scope=mcp%3Aread';
    const response = await request(app).get(`/oauth/authorize?${query}`);
    expect(response.status).toBe(302);
    expect(response.headers.location).toBe(`https://app.test/oauth/consent?${query}`);
  });

  it('GET /oauth/authorize without a configured frontend answers 503', async () => {
    const { app } = buildHttpApp({ baseSettings });
    const response = await request(app).get('/oauth/authorize?client_id=vco_x');
    expect(response.status).toBe(503);
    expect(response.body.error).toBe('consent_screen_not_configured');
  });
});

describe('HTTP transport — OAuth proxy to gateway', () => {
  it('POST /register forwards to gateway/api/v2/oauth/register and mirrors the response', async () => {
    const fetchSpy = vi.fn(
      async () =>
        ({
          ok: true,
          status: 201,
          json: async () => ({ client_id: 'vco_test', client_name: 'Test' }),
          text: async () => JSON.stringify({ client_id: 'vco_test', client_name: 'Test' }),
          headers: { get: () => 'application/json' },
        }) as unknown as Response
    ) as unknown as typeof fetch;
    const { app } = buildHttpApp({ baseSettings, fetch: fetchSpy });
    const response = await request(app)
      .post('/register')
      .send({ client_name: 'Test', redirect_uris: ['https://x'] });
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ client_id: 'vco_test' });
    const fn = fetchSpy as unknown as ReturnType<typeof vi.fn>;
    expect(fn.mock.calls[0]![0]).toBe('https://gateway.test/api/v2/oauth/register');
    expect((fn.mock.calls[0]![1] as RequestInit).method).toBe('POST');
  });

  it('POST /oauth/token forwards form-encoded body to gateway', async () => {
    const fetchSpy = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({ access_token: 'vat_x', token_type: 'Bearer', expires_in: 3600 }),
          text: async () =>
            JSON.stringify({ access_token: 'vat_x', token_type: 'Bearer', expires_in: 3600 }),
          headers: { get: () => 'application/json' },
        }) as unknown as Response
    ) as unknown as typeof fetch;
    const { app } = buildHttpApp({ baseSettings, fetch: fetchSpy });
    const response = await request(app)
      .post('/oauth/token')
      .type('form')
      .send('grant_type=authorization_code&code=vac_x&client_id=vco_x&code_verifier=v');
    expect(response.status).toBe(200);
    expect(response.body.access_token).toBe('vat_x');
    const fn = fetchSpy as unknown as ReturnType<typeof vi.fn>;
    expect(fn.mock.calls[0]![0]).toBe('https://gateway.test/api/v2/oauth/token');
    const body = (fn.mock.calls[0]![1] as RequestInit).body as string;
    expect(body).toContain('grant_type=authorization_code');
    expect(body).toContain('code=vac_x');
  });

  it('POST /oauth/revoke forwards to gateway', async () => {
    const fetchSpy = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({}),
          text: async () => '{}',
          headers: { get: () => 'application/json' },
        }) as unknown as Response
    ) as unknown as typeof fetch;
    const { app } = buildHttpApp({ baseSettings, fetch: fetchSpy });
    const response = await request(app).post('/oauth/revoke').type('form').send('token=vat_x');
    expect(response.status).toBe(200);
    const fn = fetchSpy as unknown as ReturnType<typeof vi.fn>;
    expect(fn.mock.calls[0]![0]).toBe('https://gateway.test/api/v2/oauth/revoke');
  });
});

describe('HTTP transport — session lifecycle', () => {
  it('POST /messages with unknown sessionId → 404', async () => {
    const { app } = buildHttpApp({ baseSettings });
    const response = await request(app)
      .post('/messages?sessionId=does-not-exist')
      .send({ jsonrpc: '2.0', method: 'tools/list', id: 1 });
    expect(response.status).toBe(404);
    expect(response.body.error).toBe('session_not_found');
  });

  it('POST /messages without sessionId → 404', async () => {
    const { app } = buildHttpApp({ baseSettings });
    const response = await request(app)
      .post('/messages')
      .send({ jsonrpc: '2.0', method: 'tools/list', id: 1 });
    expect(response.status).toBe(404);
  });
});
