import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildHttpApp } from '../../src/http-app.js';
import type { BaseSettings } from '../../src/config.js';

const baseSettings: BaseSettings = {
  gatewayUrl: 'https://gateway.test',
  timeoutMs: 30_000,
};

describe('CORS — browser clients can read the discovery documents', () => {
  it('GET /.well-known/oauth-protected-resource allows any origin', async () => {
    const { app } = buildHttpApp({ baseSettings });
    const response = await request(app)
      .get('/.well-known/oauth-protected-resource')
      .set('Origin', 'https://claude.ai')
      .set('host', 'mcp.test')
      .set('x-forwarded-proto', 'https');
    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe('*');
  });

  it('GET /.well-known/oauth-authorization-server allows any origin', async () => {
    const { app } = buildHttpApp({ baseSettings });
    const response = await request(app)
      .get('/.well-known/oauth-authorization-server')
      .set('Origin', 'https://claude.ai')
      .set('host', 'mcp.test')
      .set('x-forwarded-proto', 'https');
    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe('*');
  });

  it('path-aware protected-resource variants also allow any origin', async () => {
    const { app } = buildHttpApp({ baseSettings });
    for (const path of ['/mcp', '/sse']) {
      const response = await request(app)
        .get(`/.well-known/oauth-protected-resource${path}`)
        .set('Origin', 'https://claude.ai')
        .set('host', 'mcp.test')
        .set('x-forwarded-proto', 'https');
      expect(response.status).toBe(200);
      expect(response.headers['access-control-allow-origin']).toBe('*');
    }
  });
});

describe('CORS — the /mcp preflight', () => {
  it('OPTIONS /mcp answers the preflight with the MCP methods and headers', async () => {
    const { app } = buildHttpApp({ baseSettings });
    const response = await request(app)
      .options('/mcp')
      .set('Origin', 'https://claude.ai')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'authorization, content-type, mcp-session-id');
    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe('*');
    const methods = response.headers['access-control-allow-methods'] ?? '';
    expect(methods).toContain('POST');
    expect(methods).toContain('GET');
    expect(methods).toContain('DELETE');
    expect(methods).toContain('OPTIONS');
    const allowHeaders = (response.headers['access-control-allow-headers'] ?? '').toLowerCase();
    expect(allowHeaders).toContain('authorization');
    expect(allowHeaders).toContain('mcp-session-id');
  });

  it('OPTIONS /sse also answers the preflight for the legacy transport', async () => {
    const { app } = buildHttpApp({ baseSettings });
    const response = await request(app).options('/sse').set('Origin', 'https://claude.ai');
    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe('*');
  });
});

describe('CORS — the response headers a browser client must read', () => {
  it('exposes Mcp-Session-Id and WWW-Authenticate so the browser can read them', async () => {
    const { app } = buildHttpApp({ baseSettings });
    const response = await request(app)
      .get('/.well-known/oauth-authorization-server')
      .set('Origin', 'https://claude.ai')
      .set('host', 'mcp.test')
      .set('x-forwarded-proto', 'https');
    const expose = (response.headers['access-control-expose-headers'] ?? '').toLowerCase();
    expect(expose).toContain('mcp-session-id');
    expect(expose).toContain('www-authenticate');
  });

  it('GET /mcp without Authorization returns 401 that a cross-origin client can read', async () => {
    const { app } = buildHttpApp({ baseSettings });
    const response = await request(app).get('/mcp').set('Origin', 'https://claude.ai');
    expect(response.status).toBe(401);
    expect(response.headers['access-control-allow-origin']).toBe('*');
  });
});
