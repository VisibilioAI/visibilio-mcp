import express, { type Express, type Request, type Response } from 'express';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { buildServer } from './server.js';
import { withApiKey, type BaseSettings } from './config.js';
import { AuthenticationError } from './auth.js';

export interface HttpAppOptions {
  baseSettings: BaseSettings;
  fetch?: typeof fetch;
}

export interface HttpApp {
  app: Express;
  sessions: Map<string, SSEServerTransport>;
}

export function buildHttpApp(options: HttpAppOptions): HttpApp {
  const { baseSettings, fetch: fetchImpl } = options;
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  const httpFetch: typeof fetch = fetchImpl ?? globalThis.fetch;

  const sessions = new Map<string, SSEServerTransport>();

  // Note: /healthz is reserved by Google Cloud Run's frontend and is
  // intercepted before reaching the container — GFE returns its own
  // branded 404. Use /health for health checks instead.
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: '@visibilio/mcp', sessions: sessions.size });
  });

  // RFC 9728 protected resource metadata. The MCP server itself is the
  // OAuth resource — `resource` and `authorization_servers` both name
  // this host (not the gateway), so clients that probe same-origin (like
  // claude.ai) find the AS metadata at /.well-known/oauth-authorization-server
  // here and DCR-register against /register on this host. The proxy
  // handlers below forward to the gateway transparently.
  const protectedResourceHandler = (req: Request, res: Response) => {
    const self = ownOrigin(req);
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json({
      resource: self,
      authorization_servers: [self],
      bearer_methods_supported: ['header'],
      scopes_supported: ['mcp:read', 'mcp:write', 'mcp:admin'],
      resource_documentation: 'https://visibilio.ai/docs/mcp',
    });
  };
  app.get('/.well-known/oauth-protected-resource', protectedResourceHandler);
  app.get('/.well-known/oauth-protected-resource/sse', protectedResourceHandler);

  // RFC 8414 authorization server metadata, also served on this host so
  // single-origin discovery clients can find it. Endpoint URLs point at
  // the proxy handlers below; authorization_endpoint is the FE consent
  // page (browser-facing) when configured.
  app.get('/.well-known/oauth-authorization-server', (req: Request, res: Response) => {
    const self = ownOrigin(req);
    const authEndpoint = baseSettings.frontendUrl
      ? `${baseSettings.frontendUrl.replace(/\/$/, '')}/oauth/consent`
      : `${self}/oauth/authorize`;
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json({
      issuer: self,
      authorization_endpoint: authEndpoint,
      token_endpoint: `${self}/oauth/token`,
      registration_endpoint: `${self}/register`,
      revocation_endpoint: `${self}/oauth/revoke`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: ['none', 'client_secret_basic', 'client_secret_post'],
      code_challenge_methods_supported: ['S256', 'plain'],
      scopes_supported: ['mcp:read', 'mcp:write', 'mcp:admin'],
      service_documentation: 'https://visibilio.ai/docs/mcp',
    });
  });

  // OAuth proxy handlers — pass-through to the gateway. We don't
  // re-implement OAuth logic here; we just provide a same-origin
  // surface for clients that probe the resource server first.
  const proxyToGateway = (gatewayPath: string) => {
    return async (req: Request, res: Response) => {
      try {
        const target = `${baseSettings.gatewayUrl.replace(/\/$/, '')}${gatewayPath}`;
        const headers: Record<string, string> = {};
        const ct = req.header('content-type');
        if (ct) headers['Content-Type'] = ct;
        const auth = req.header('authorization');
        if (auth) headers.Authorization = auth;
        const body = serializeBody(req);
        const upstream = await httpFetch(target, { method: 'POST', headers, body });
        const text = await upstream.text();
        const upstreamCt = upstream.headers.get('content-type');
        if (upstreamCt) res.setHeader('Content-Type', upstreamCt);
        res.status(upstream.status).send(text);
      } catch (err) {
        res.status(502).json({
          error: 'gateway_proxy_failed',
          message: err instanceof Error ? err.message : 'unknown',
        });
      }
    };
  };
  app.post('/register', proxyToGateway('/api/v2/oauth/register'));
  app.post('/oauth/token', proxyToGateway('/api/v2/oauth/token'));
  app.post('/oauth/revoke', proxyToGateway('/api/v2/oauth/revoke'));

  app.get('/sse', async (req: Request, res: Response) => {
    const apiKey = extractBearer(req);
    if (!apiKey) {
      setBearerChallenge(req, res, {
        error: 'invalid_token',
        description:
          'Authorization required. Authenticate via OAuth (RFC 9728 metadata served at /.well-known/oauth-protected-resource) or send Authorization: Bearer vsk_<api-key>',
      });
      res.status(401).json({
        error: 'missing_authorization',
        message: 'Authorization: Bearer vsk_... (API key) or vat_... (OAuth)',
      });
      return;
    }

    let settings;
    try {
      settings = withApiKey(baseSettings, apiKey);
    } catch {
      setBearerChallenge(req, res, {
        error: 'invalid_token',
        description: 'Bearer token must start with vsk_ (API key) or vat_ (OAuth)',
      });
      res.status(401).json({
        error: 'invalid_api_key',
        message: 'Bearer token must start with vsk_ (API key) or vat_ (OAuth)',
      });
      return;
    }

    let transport: SSEServerTransport | undefined;
    try {
      transport = new SSEServerTransport('/messages', res);
      const { server } = await buildServer({ settings, fetch: fetchImpl });
      sessions.set(transport.sessionId, transport);
      res.on('close', () => {
        const t = transport;
        if (!t) return;
        sessions.delete(t.sessionId);
        void t.close().catch(() => undefined);
      });
      await server.connect(transport);
    } catch (err) {
      if (transport) {
        sessions.delete(transport.sessionId);
        await transport.close().catch(() => undefined);
      }
      if (err instanceof AuthenticationError) {
        if (!res.headersSent) {
          if (err.status !== 403) {
            setBearerChallenge(req, res, {
              error: 'invalid_token',
              description: err.message,
            });
          }
          res.status(err.status === 403 ? 403 : 401).json({
            error: err.status === 403 ? 'expired_or_revoked_key' : 'invalid_api_key',
            message: err.message,
          });
        }
        return;
      }
      console.error('[visibilio-mcp/http] sse error:', err);
      if (!res.headersSent) {
        res.status(500).json({
          error: 'internal_error',
          message: err instanceof Error ? err.message : 'unknown',
        });
      }
    }
  });

  app.post('/messages', async (req: Request, res: Response) => {
    const sessionId = req.query.sessionId as string | undefined;
    const transport = sessionId ? sessions.get(sessionId) : undefined;
    if (!transport) {
      res.status(404).json({ error: 'session_not_found' });
      return;
    }
    await transport.handlePostMessage(req, res);
  });

  return { app, sessions };
}

function extractBearer(req: Request): string | null {
  const header = req.header('authorization');
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1] ?? null;
}

function ownOrigin(req: Request): string {
  const proto = (req.header('x-forwarded-proto') ?? 'https').split(',')[0]!.trim();
  const host = (req.header('x-forwarded-host') ?? req.header('host') ?? '').split(',')[0]!.trim();
  return `${proto}://${host}`;
}

function serializeBody(req: Request): string {
  const ct = req.header('content-type') ?? '';
  if (ct.includes('application/x-www-form-urlencoded')) {
    return new URLSearchParams(req.body as Record<string, string>).toString();
  }
  return JSON.stringify(req.body ?? {});
}

function setBearerChallenge(
  req: Request,
  res: Response,
  options: { error: string; description: string }
): void {
  const proto = (req.header('x-forwarded-proto') ?? 'https').split(',')[0]!.trim();
  const host = (req.header('x-forwarded-host') ?? req.header('host') ?? '').split(',')[0]!.trim();
  const resourceMetadata = `${proto}://${host}/.well-known/oauth-protected-resource`;
  // RFC 6750 quoted-string requires printable ASCII; strip control chars,
  // non-ASCII (e.g. em-dash from upstream messages), and escape backslash + quote.
  const sanitize = (v: string) =>
    v
      .replace(/[^\x20-\x7E]/g, ' ')
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"');
  const challenge = `Bearer realm="visibilio-mcp", resource_metadata="${resourceMetadata}", error="${sanitize(options.error)}", error_description="${sanitize(options.description)}"`;
  res.setHeader('WWW-Authenticate', challenge);
}
