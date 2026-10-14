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
    const gatewayCalls = () =>
      vi.mocked(fetchImpl).mock.calls.map(([url]) => new URL(String(url)).pathname);
    const callsAfterInitialize = gatewayCalls().length;

    await post(app, '/mcp')
      .set('Authorization', 'Bearer vsk_valid')
      .set('Mcp-Session-Id', sessionId!)
      .send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });

    expect(gatewayCalls().filter((path) => path === '/api/v2/auth/me')).toHaveLength(1);
    expect(gatewayCalls()).toHaveLength(callsAfterInitialize);
  });

  it("a request with a session id but another user's credential → 401 (session ids are not bearer tokens)", async () => {
    const fetchImpl = gatewayFetchByUser({ vsk_valid: ME, vsk_other: OTHER_USER });
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

const ME_TWO_ORGS = {
  ...ME,
  organizations: [
    { id: 158, name: 'Visibilio', role: 'owner' },
    { id: 206, name: 'Dobra kola', role: 'admin' },
  ],
};

async function initializeAs(app: ReturnType<typeof buildHttpApp>['app'], credential: string) {
  const response = await post(app, '/mcp')
    .set('Authorization', `Bearer ${credential}`)
    .send(initializeRequest);
  return response.headers['mcp-session-id'] as string;
}

async function callTool(
  app: ReturnType<typeof buildHttpApp>['app'],
  sessionId: string,
  credential: string,
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  const response = await post(app, '/mcp')
    .set('Authorization', `Bearer ${credential}`)
    .set('Mcp-Session-Id', sessionId)
    .send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name, arguments: args } });
  return response.body.result.content[0].text as string;
}

describe('Streamable HTTP transport — a new session resumes where the same credential left off', () => {
  it('after set_active_organization and set_active_product, a re-initialized session starts there', async () => {
    const fetchImpl = gatewayFetch({
      '/api/v2/auth/me': { body: ME_TWO_ORGS },
      '/api/v2/products/284': { body: { data: { id: 284, name: 'dobrakola.bg' } } },
    });
    const { app } = buildHttpApp({ baseSettings, fetch: fetchImpl });
    const first = await initializeAs(app, 'vsk_valid');
    await callTool(app, first, 'vsk_valid', 'set_active_organization', { organization_id: 206 });
    await callTool(app, first, 'vsk_valid', 'set_active_product', { product_id: 284 });

    const second = await initializeAs(app, 'vsk_valid');
    const whoami = await callTool(app, second, 'vsk_valid', 'whoami', {});

    expect(whoami).toContain('organization_id: 206');
    expect(whoami).toContain('product_id: 284');
  });

  it('a renewed token of the same user resumes there too (the context belongs to the user, not the token)', async () => {
    const fetchImpl = gatewayFetch({ '/api/v2/auth/me': { body: ME_TWO_ORGS } });
    const { app } = buildHttpApp({ baseSettings, fetch: fetchImpl });
    const first = await initializeAs(app, 'vat_old');
    await callTool(app, first, 'vat_old', 'set_active_organization', { organization_id: 206 });

    const renewed = await initializeAs(app, 'vat_new');
    const whoami = await callTool(app, renewed, 'vat_new', 'whoami', {});

    expect(whoami).toContain('organization_id: 206');
  });

  it("another user's credential still starts in its own default organization", async () => {
    const fetchImpl = gatewayFetchByUser({ vsk_valid: ME_TWO_ORGS, vsk_other: OTHER_USER });
    const { app } = buildHttpApp({ baseSettings, fetch: fetchImpl });
    const first = await initializeAs(app, 'vsk_valid');
    await callTool(app, first, 'vsk_valid', 'set_active_organization', { organization_id: 206 });

    const other = await initializeAs(app, 'vsk_other');
    const whoami = await callTool(app, other, 'vsk_other', 'whoami', {});

    expect(whoami).toContain('organization_id: 158');
  });
});

const OTHER_USER = {
  user: { id: 99, email: 'other@example.com', name: 'Other User' },
  organizations: [{ id: 158, name: 'Visibilio', role: 'member' }],
  default_organization_id: 158,
};

function gatewayFetchByUser(usersByCredential: Record<string, unknown>): typeof fetch {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    const bearer = String(
      (init?.headers as Record<string, string> | undefined)?.Authorization ?? ''
    ).replace(/^Bearer /, '');
    const me = usersByCredential[bearer];
    const status =
      path === '/api/v2/auth/me' ? (me ? 200 : 401) : path === '/api/v2/products' ? 200 : 404;
    const body =
      path === '/api/v2/auth/me'
        ? (me ?? { error: 'Unauthorized' })
        : path === '/api/v2/products'
          ? { data: [] }
          : {};
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      text: async () => JSON.stringify(body),
      json: async () => body,
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

describe('Streamable HTTP transport — an OAuth token refresh does not end the session', () => {
  it('a renewed token of the same user keeps the session and is used for the gateway from then on', async () => {
    const fetchImpl = gatewayFetchByUser({ vat_old: ME_TWO_ORGS, vat_new: ME_TWO_ORGS });
    const { app } = buildHttpApp({ baseSettings, fetch: fetchImpl });
    const sessionId = await initializeAs(app, 'vat_old');
    await callTool(app, sessionId, 'vat_old', 'set_active_organization', { organization_id: 206 });

    const response = await post(app, '/mcp')
      .set('Authorization', 'Bearer vat_new')
      .set('Mcp-Session-Id', sessionId)
      .send({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'list_products', arguments: {} },
      });

    expect(response.status).toBe(200);
    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls as Array<
      [string, RequestInit]
    >;
    const productsCall = calls.filter(([url]) => url.endsWith('/api/v2/products')).at(-1);
    expect((productsCall?.[1].headers as Record<string, string>).Authorization).toBe(
      'Bearer vat_new'
    );
    expect((productsCall?.[1].headers as Record<string, string>)['X-Organization-Id']).toBe('206');
  });

  it("a different user's credential on an existing session is still refused with 401", async () => {
    const fetchImpl = gatewayFetchByUser({ vsk_valid: ME_TWO_ORGS, vsk_other: OTHER_USER });
    const { app } = buildHttpApp({ baseSettings, fetch: fetchImpl });
    const sessionId = await initializeAs(app, 'vsk_valid');

    const response = await post(app, '/mcp')
      .set('Authorization', 'Bearer vsk_other')
      .set('Mcp-Session-Id', sessionId)
      .send({ jsonrpc: '2.0', id: 4, method: 'tools/list', params: {} });

    expect(response.status).toBe(401);
  });

  it('a credential the gateway rejects on an existing session is refused with 401', async () => {
    const fetchImpl = gatewayFetchByUser({ vsk_valid: ME_TWO_ORGS });
    const { app } = buildHttpApp({ baseSettings, fetch: fetchImpl });
    const sessionId = await initializeAs(app, 'vsk_valid');

    const response = await post(app, '/mcp')
      .set('Authorization', 'Bearer vsk_expired')
      .set('Mcp-Session-Id', sessionId)
      .send({ jsonrpc: '2.0', id: 4, method: 'tools/list', params: {} });

    expect(response.status).toBe(401);
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

function respond(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response;
}

function contextGateway(remembered: unknown, write: { status?: number; delayMs?: number } = {}) {
  const writes: unknown[] = [];
  const events: string[] = [];
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = new URL(url).pathname;
    if (path === '/api/v2/mcp/context' && method === 'PUT') {
      await new Promise((resolve) => setTimeout(resolve, write.delayMs ?? 0));
      writes.push(JSON.parse(String(init?.body)));
      events.push('context written');
      return respond(write.status ?? 200, { data: {} });
    }
    if (path === '/api/v2/mcp/context') {
      return remembered === undefined
        ? respond(404, { error: 'not_found' })
        : respond(200, remembered);
    }
    if (path === '/api/v2/auth/me') return respond(200, ME_TWO_ORGS);
    if (path === '/api/v2/products/284') {
      return respond(200, { data: { id: 284, name: 'dobrakola.bg' } });
    }
    return respond(404, { error: 'not_found' });
  }) as unknown as typeof fetch;
  return { fetchImpl, writes, events };
}

describe('Streamable HTTP transport — the context outlives a server restart (meta#785)', () => {
  it('a fresh server resumes the organization and product the gateway remembers', async () => {
    const { fetchImpl } = contextGateway({
      data: { organization_id: 206, product_id: 284, product_name: 'dobrakola.bg' },
    });
    const { app } = buildHttpApp({ baseSettings, fetch: fetchImpl });

    const session = await initializeAs(app, 'vat_after_restart');
    const whoami = await callTool(app, session, 'vat_after_restart', 'whoami', {});

    expect(whoami).toContain('organization_id: 206');
    expect(whoami).toContain('dobrakola.bg (product_id: 284)');
  });

  it('switching organization and product is saved with the gateway before the tool answers', async () => {
    const { fetchImpl, writes, events } = contextGateway({ data: null }, { delayMs: 20 });
    const { app } = buildHttpApp({ baseSettings, fetch: fetchImpl });
    const session = await initializeAs(app, 'vsk_valid');

    await callTool(app, session, 'vsk_valid', 'set_active_organization', { organization_id: 206 });
    events.push('organization tool answered');
    await callTool(app, session, 'vsk_valid', 'set_active_product', { product_id: 284 });
    events.push('product tool answered');

    expect(writes).toEqual([
      { organization_id: 206, product_id: null },
      { organization_id: 206, product_id: 284 },
    ]);
    expect(events).toEqual([
      'context written',
      'organization tool answered',
      'context written',
      'product tool answered',
    ]);
  });

  it('a remembered organization the user has left is ignored', async () => {
    const { fetchImpl } = contextGateway({
      data: { organization_id: 999, product_id: null, product_name: null },
    });
    const { app } = buildHttpApp({ baseSettings, fetch: fetchImpl });

    const session = await initializeAs(app, 'vsk_valid');
    const whoami = await callTool(app, session, 'vsk_valid', 'whoami', {});

    expect(whoami).toContain('organization_id: 158');
  });

  it('without the gateway route a session starts in the home organization, as before', async () => {
    const { fetchImpl } = contextGateway(undefined);
    const { app } = buildHttpApp({ baseSettings, fetch: fetchImpl });

    const session = await initializeAs(app, 'vsk_valid');
    const whoami = await callTool(app, session, 'vsk_valid', 'whoami', {});

    expect(whoami).toContain('organization_id: 158');
  });

  it('a failed write does not undo the switch', async () => {
    const { fetchImpl } = contextGateway({ data: null }, { status: 500 });
    const { app } = buildHttpApp({ baseSettings, fetch: fetchImpl });
    const session = await initializeAs(app, 'vsk_valid');

    const answer = await callTool(app, session, 'vsk_valid', 'set_active_organization', {
      organization_id: 206,
    });
    const whoami = await callTool(app, session, 'vsk_valid', 'whoami', {});

    expect(answer).toContain('Active organization set to Dobra kola');
    expect(whoami).toContain('organization_id: 206');
  });
});
