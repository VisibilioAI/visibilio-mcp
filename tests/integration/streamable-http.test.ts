import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { buildHttpApp } from '../../src/http-app.js';
import type { BaseSettings } from '../../src/config.js';

const baseSettings: BaseSettings = {
  gatewayUrl: 'https://gateway.test',
  timeoutMs: 30_000,
};

const ME = {
  user: { id: 42, email: 'owner@example.com', name: 'Owner Example' },
  organizations: [{ id: 158, name: 'Visibilio', role: 'owner' }],
  default_organization_id: 158,
};

function gatewayFetch(routes: Record<string, { status?: number; body: unknown }>): typeof fetch {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = new URL(url).pathname;
    const route = routes[`${method} ${path}`] ?? routes[path];
    const status = route?.status ?? (route ? 200 : 404);
    const body = route?.body ?? { error: 'not_found' };
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      text: async () => JSON.stringify(body),
      json: async () => body,
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

const initializeRequest = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test-client', version: '0.0.0' },
  },
};

function post(app: ReturnType<typeof buildHttpApp>['app'], path: string) {
  return request(app)
    .post(path)
    .set('Accept', 'application/json, text/event-stream')
    .set('Content-Type', 'application/json');
}

async function initialize(app: ReturnType<typeof buildHttpApp>['app'], path = '/mcp') {
  const response = await post(app, path)
    .set('Authorization', 'Bearer vsk_valid')
    .send(initializeRequest);
  return { response, sessionId: response.headers['mcp-session-id'] as string | undefined };
}

describe('Streamable HTTP transport — unauthenticated probe', () => {
  it.each(['/mcp', '/sse'])(
    'POST %s without Authorization → 401 with an RFC 9728 WWW-Authenticate challenge',
    async (path) => {
      const { app } = buildHttpApp({ baseSettings });

      const response = await post(app, path).send(initializeRequest);

      expect(response.status).toBe(401);
      expect(response.headers['www-authenticate']).toMatch(/^Bearer /);
      expect(response.headers['www-authenticate']).toContain(
        '/.well-known/oauth-protected-resource'
      );
    }
  );

  it('POST /mcp with a credential the gateway rejects → 401 and no session is created', async () => {
    const fetchImpl = gatewayFetch({ '/api/v2/auth/me': { status: 401, body: { error: 'nope' } } });
    const { app, sessions } = buildHttpApp({ baseSettings, fetch: fetchImpl });

    const response = await post(app, '/mcp')
      .set('Authorization', 'Bearer vsk_revoked')
      .send(initializeRequest);

    expect(response.status).toBe(401);
    expect(response.headers['www-authenticate']).toMatch(/^Bearer /);
    expect(sessions.size).toBe(0);
  });
});

describe('Streamable HTTP transport — session lifecycle', () => {
  it('POST /mcp initialize with a valid credential → 200, a JSON-RPC result and an Mcp-Session-Id', async () => {
    const fetchImpl = gatewayFetch({ '/api/v2/auth/me': { body: ME } });
    const { app } = buildHttpApp({ baseSettings, fetch: fetchImpl });

    const { response, sessionId } = await initialize(app);

    expect(response.status).toBe(200);
    expect(sessionId).toBeTruthy();
    expect(response.body).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: { serverInfo: { name: '@visibilio/mcp' }, capabilities: { tools: {} } },
    });
  });

  it('POST /sse is the same Streamable HTTP endpoint (claude.ai connectors were registered with /sse)', async () => {
    const fetchImpl = gatewayFetch({ '/api/v2/auth/me': { body: ME } });
    const { app } = buildHttpApp({ baseSettings, fetch: fetchImpl });

    const { response, sessionId } = await initialize(app, '/sse');

    expect(response.status).toBe(200);
    expect(sessionId).toBeTruthy();
  });

  it('a follow-up tools/list on the session returns the tool catalogue', async () => {
    const fetchImpl = gatewayFetch({ '/api/v2/auth/me': { body: ME } });
    const { app } = buildHttpApp({ baseSettings, fetch: fetchImpl });
    const { sessionId } = await initialize(app);

    const response = await post(app, '/mcp')
      .set('Authorization', 'Bearer vsk_valid')
      .set('Mcp-Session-Id', sessionId!)
      .send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });

    expect(response.status).toBe(200);
    const names = (response.body.result.tools as Array<{ name: string }>).map((t) => t.name);
    expect(names).toContain('list_products');
    expect(names).toContain('whoami');
  });

  it('authenticates the gateway once per session, not once per request', async () => {
    const fetchImpl = gatewayFetch({ '/api/v2/auth/me': { body: ME } });
    const { app } = buildHttpApp({ baseSettings, fetch: fetchImpl });
    const { sessionId } = await initialize(app);

    await post(app, '/mcp')
      .set('Authorization', 'Bearer vsk_valid')
      .set('Mcp-Session-Id', sessionId!)
      .send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('a request with a session id but a different credential → 401 (session ids are not bearer tokens)', async () => {
    const fetchImpl = gatewayFetch({ '/api/v2/auth/me': { body: ME } });
    const { app } = buildHttpApp({ baseSettings, fetch: fetchImpl });
    const { sessionId } = await initialize(app);

    const response = await post(app, '/mcp')
      .set('Authorization', 'Bearer vsk_other')
      .set('Mcp-Session-Id', sessionId!)
      .send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });

    expect(response.status).toBe(401);
  });

  it('an unknown session id → 404 so the client re-initializes', async () => {
    const fetchImpl = gatewayFetch({ '/api/v2/auth/me': { body: ME } });
    const { app } = buildHttpApp({ baseSettings, fetch: fetchImpl });

    const response = await post(app, '/mcp')
      .set('Authorization', 'Bearer vsk_valid')
      .set('Mcp-Session-Id', 'does-not-exist')
      .send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });

    expect(response.status).toBe(404);
  });

  it('DELETE /mcp ends the session and frees it from the session table', async () => {
    const fetchImpl = gatewayFetch({ '/api/v2/auth/me': { body: ME } });
    const { app, sessions } = buildHttpApp({ baseSettings, fetch: fetchImpl });
    const { sessionId } = await initialize(app);
    expect(sessions.size).toBe(1);

    const response = await request(app)
      .delete('/mcp')
      .set('Authorization', 'Bearer vsk_valid')
      .set('Mcp-Session-Id', sessionId!);

    expect([200, 204]).toContain(response.status);
    expect(sessions.size).toBe(0);
  });
});

describe('Streamable HTTP transport — landing', () => {
  it('GET / describes the server instead of returning 404', async () => {
    const { app } = buildHttpApp({ baseSettings });

    const response = await request(app).get('/');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ service: '@visibilio/mcp', mcp_endpoint: '/mcp' });
  });
});
