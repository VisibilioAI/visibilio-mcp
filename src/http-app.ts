import { createHash, randomUUID } from 'node:crypto';
import express, { type Express, type Request, type Response } from 'express';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { buildServer } from './server.js';
import type { SessionContext } from './session.js';
import { withCredential, type BaseSettings, type Settings } from './config.js';
import { AuthenticationError, McpAuth, type AuthContext } from './auth.js';
import type { VisibilioClient } from './client.js';
import { loadRememberedContext, rememberContext } from './remembered-context.js';
import { SERVER_NAME, SERVER_VERSION } from './server.js';

export interface HttpAppOptions {
  baseSettings: BaseSettings;
  fetch?: typeof fetch;
}

export interface LiveSession {
  readonly kind: 'streamable' | 'sse';
  readonly userId: number;
  credentialHash: string;
  rebind(credential: string, credentialHash: string): void;
  close(): Promise<void>;
}

export interface HttpApp {
  app: Express;
  sessions: Map<string, LiveSession>;
}

const SESSION_HEADER = 'mcp-session-id';
const STREAMABLE_PATHS = ['/mcp', '/sse'] as const;
const DOCUMENTATION_URL = 'https://github.com/VisibilioAI/visibilio-mcp/blob/main/docs/install.md';

export function buildHttpApp(options: HttpAppOptions): HttpApp {
  const { baseSettings, fetch: fetchImpl } = options;
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  const httpFetch: typeof fetch = fetchImpl ?? globalThis.fetch.bind(globalThis);

  const sessions = new Map<string, LiveSession>();
  // Last active organization and product per user: a client that re-initializes (new
  // session per turn, re-authentication after a token refresh) resumes where it left off
  // instead of silently falling back to the home organization. The gateway keeps them
  // too, so a fresh server after a restart resumes there as well (meta#785).
  const contexts = new Map<number, SessionContext>();
  const serverOptions = {
    contextFor: async (auth: AuthContext, client: VisibilioClient) =>
      contexts.get(auth.userId) ?? (await loadRememberedContext(client)),
    onContextChange: async (
      auth: AuthContext,
      client: VisibilioClient,
      context: SessionContext
    ) => {
      contexts.set(auth.userId, context);
      await rememberContext(client, context);
    },
  };
  const resolveUserId = async (settings: Settings): Promise<number> => {
    const auth = new McpAuth({
      credential: settings.credential,
      gatewayUrl: settings.gatewayUrl,
      fetch: fetchImpl,
    });
    return (await auth.resolve()).userId;
  };
  const streamableTransports = new Map<string, StreamableHTTPServerTransport>();
  const sseTransports = new Map<string, SSEServerTransport>();

  app.get('/', (_req: Request, res: Response) => {
    res.json({
      service: SERVER_NAME,
      version: SERVER_VERSION,
      mcp_endpoint: '/mcp',
      transports: ['streamable-http', 'sse (legacy)'],
      documentation: 'https://github.com/VisibilioAI/visibilio-mcp#readme',
    });
  });

  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: SERVER_NAME,
      version: SERVER_VERSION,
      sessions: sessions.size,
    });
  });

  const protectedResourceHandler = (req: Request, res: Response) => {
    const self = ownOrigin(req);
    const resourcePath = req.path.endsWith('/sse') ? '/sse' : '/mcp';
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json({
      resource: `${self}${resourcePath}`,
      authorization_servers: [self],
      bearer_methods_supported: ['header'],
      scopes_supported: ['mcp:read', 'mcp:write', 'mcp:admin'],
      resource_documentation: DOCUMENTATION_URL,
    });
  };
  app.get('/.well-known/oauth-protected-resource', protectedResourceHandler);
  app.get('/.well-known/oauth-protected-resource/sse', protectedResourceHandler);
  app.get('/.well-known/oauth-protected-resource/mcp', protectedResourceHandler);

  app.get('/.well-known/oauth-authorization-server', (req: Request, res: Response) => {
    const self = ownOrigin(req);
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json({
      issuer: self,
      authorization_endpoint: `${self}/oauth/authorize`,
      token_endpoint: `${self}/oauth/token`,
      registration_endpoint: `${self}/register`,
      revocation_endpoint: `${self}/oauth/revoke`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: ['none', 'client_secret_basic', 'client_secret_post'],
      code_challenge_methods_supported: ['S256'],
      scopes_supported: ['mcp:read', 'mcp:write', 'mcp:admin'],
      service_documentation: DOCUMENTATION_URL,
    });
  });

  const proxyToGateway = (gatewayPath: string) => {
    return async (req: Request, res: Response) => {
      try {
        const target = `${baseSettings.gatewayUrl.replace(/\/$/, '')}${gatewayPath}`;
        const headers: Record<string, string> = {};
        const ct = req.header('content-type');
        if (ct) headers['Content-Type'] = ct;
        const auth = req.header('authorization');
        if (auth) headers.Authorization = auth;
        const upstream = await httpFetch(target, {
          method: 'POST',
          headers,
          body: serializeBody(req),
        });
        const text = await upstream.text();
        const upstreamCt = upstream.headers.get('content-type');
        if (upstreamCt) res.setHeader('Content-Type', upstreamCt);
        res.status(upstream.status).send(text);
      } catch (err) {
        const detail = err instanceof Error ? err.message : 'unknown';
        console.error('[visibilio-mcp/http] proxy error:', detail);
        res.status(502).json({ error: 'gateway_proxy_failed', message: detail });
      }
    };
  };
  // Clients such as Codex refuse an authorization endpoint on another origin than the issuer
  // unless the server supports issuer-bound callbacks (RFC 9207). The consent screen lives in
  // the app, so the issuer-origin endpoint forwards the request there untouched.
  app.get('/oauth/authorize', (req: Request, res: Response) => {
    if (!baseSettings.frontendUrl) {
      res.status(503).json({
        error: 'consent_screen_not_configured',
        message: 'VISIBILIO_FRONTEND_URL is not set on this server',
      });
      return;
    }
    const queryStart = req.originalUrl.indexOf('?');
    const query = queryStart === -1 ? '' : req.originalUrl.slice(queryStart);
    res.redirect(302, `${baseSettings.frontendUrl.replace(/\/$/, '')}/oauth/consent${query}`);
  });

  app.post('/register', proxyToGateway('/api/v2/oauth/register'));
  app.post('/oauth/token', proxyToGateway('/api/v2/oauth/token'));
  app.post('/oauth/revoke', proxyToGateway('/api/v2/oauth/revoke'));

  const rejectMissingCredential = (req: Request, res: Response) => {
    setBearerChallenge(req, res, {
      error: 'invalid_token',
      description:
        'Authorization required. Authenticate via OAuth (RFC 9728 metadata at /.well-known/oauth-protected-resource) or send Authorization: Bearer vsk_<api-key>',
    });
    res.status(401).json({
      error: 'missing_authorization',
      message: 'Authorization: Bearer vsk_... (API key) or vat_... (OAuth access token)',
    });
  };

  const rejectAuthenticationFailure = (req: Request, res: Response, err: AuthenticationError) => {
    if (res.headersSent) return;
    const status = err.status === 403 ? 403 : err.status === 502 ? 502 : 401;
    if (status === 401) {
      setBearerChallenge(req, res, { error: 'invalid_token', description: err.message });
    }
    res.status(status).json({
      error:
        status === 403
          ? 'insufficient_scope'
          : status === 502
            ? 'gateway_unavailable'
            : 'invalid_credential',
      message: err.message,
    });
  };

  const parseSettings = (req: Request, res: Response): Settings | null => {
    const credential = extractBearer(req);
    if (!credential) {
      rejectMissingCredential(req, res);
      return null;
    }
    try {
      return withCredential(baseSettings, credential);
    } catch {
      setBearerChallenge(req, res, {
        error: 'invalid_token',
        description: 'Bearer token must start with vsk_ (API key) or vat_ (OAuth access token)',
      });
      res.status(401).json({
        error: 'invalid_credential',
        message: 'Bearer token must start with vsk_ (API key) or vat_ (OAuth access token)',
      });
      return null;
    }
  };

  const handleStreamable = async (req: Request, res: Response) => {
    const settings = parseSettings(req, res);
    if (!settings) return;
    const credentialHash = hashCredential(settings.credential);
    const sessionId = req.header(SESSION_HEADER);

    if (sessionId) {
      const live = sessions.get(sessionId);
      const transport = streamableTransports.get(sessionId);
      if (!live || !transport) {
        res.status(404).json({
          jsonrpc: '2.0',
          error: { code: -32001, message: 'Session not found — send a new initialize request' },
          id: null,
        });
        return;
      }
      if (live.credentialHash !== credentialHash) {
        // OAuth access tokens expire hourly; a renewed token of the same user keeps the session.
        let sameUser = false;
        try {
          sameUser = (await resolveUserId(settings)) === live.userId;
        } catch (err) {
          if (err instanceof AuthenticationError) {
            rejectAuthenticationFailure(req, res, err);
            return;
          }
          throw err;
        }
        if (!sameUser) {
          setBearerChallenge(req, res, {
            error: 'invalid_token',
            description: 'Credential does not match the session',
          });
          res.status(401).json({
            error: 'invalid_credential',
            message: 'Credential does not match the session',
          });
          return;
        }
        live.rebind(settings.credential, credentialHash);
      }
      await transport.handleRequest(req, res, req.body);
      return;
    }

    if (req.method !== 'POST') {
      res
        .status(405)
        .json({ error: 'method_not_allowed', message: 'Send a POST initialize request first' });
      return;
    }

    let built;
    try {
      built = await buildServer({ settings, fetch: fetchImpl, ...serverOptions });
    } catch (err) {
      if (err instanceof AuthenticationError) {
        rejectAuthenticationFailure(req, res, err);
        return;
      }
      console.error('[visibilio-mcp/http] streamable init error:', err);
      res
        .status(500)
        .json({ error: 'internal_error', message: err instanceof Error ? err.message : 'unknown' });
      return;
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: true,
      onsessioninitialized: (id) => {
        streamableTransports.set(id, transport);
        const live: LiveSession = {
          kind: 'streamable',
          userId: built.session.userId,
          credentialHash,
          rebind(credential, hash) {
            built.session.client.setCredential(credential);
            live.credentialHash = hash;
          },
          close: () => transport.close(),
        };
        sessions.set(id, live);
      },
      onsessionclosed: (id) => {
        streamableTransports.delete(id);
        sessions.delete(id);
      },
    });
    transport.onclose = () => {
      const id = transport.sessionId;
      if (!id) return;
      streamableTransports.delete(id);
      sessions.delete(id);
    };
    await built.server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  };

  for (const path of STREAMABLE_PATHS) {
    app.post(path, handleStreamable);
    app.delete(path, handleStreamable);
  }
  app.get('/mcp', handleStreamable);

  app.get('/sse', async (req: Request, res: Response) => {
    if (req.header(SESSION_HEADER)) {
      await handleStreamable(req, res);
      return;
    }
    const settings = parseSettings(req, res);
    if (!settings) return;

    let transport: SSEServerTransport | undefined;
    try {
      transport = new SSEServerTransport('/messages', res);
      const built = await buildServer({ settings, fetch: fetchImpl, ...serverOptions });
      const id = transport.sessionId;
      const t = transport;
      sseTransports.set(id, t);
      const live: LiveSession = {
        kind: 'sse',
        userId: built.session.userId,
        credentialHash: hashCredential(settings.credential),
        rebind(credential, hash) {
          built.session.client.setCredential(credential);
          live.credentialHash = hash;
        },
        close: () => t.close(),
      };
      sessions.set(id, live);
      res.on('close', () => {
        sseTransports.delete(id);
        sessions.delete(id);
        void t.close().catch(() => undefined);
      });
      await built.server.connect(transport);
    } catch (err) {
      if (transport) {
        sseTransports.delete(transport.sessionId);
        sessions.delete(transport.sessionId);
        await transport.close().catch(() => undefined);
      }
      if (err instanceof AuthenticationError) {
        rejectAuthenticationFailure(req, res, err);
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
    const transport = sessionId ? sseTransports.get(sessionId) : undefined;
    if (!transport) {
      res.status(404).json({ error: 'session_not_found' });
      return;
    }
    await transport.handlePostMessage(req, res, req.body);
  });

  return { app, sessions };
}

function hashCredential(credential: string): string {
  return createHash('sha256').update(credential).digest('hex');
}

function extractBearer(req: Request): string | null {
  const header = req.header('authorization');
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() ?? null;
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
  const resourcePath = req.path === '/sse' ? '/sse' : '/mcp';
  const resourceMetadata = `${ownOrigin(req)}/.well-known/oauth-protected-resource${resourcePath}`;
  const sanitize = (v: string) =>
    v
      .replace(/[^\x20-\x7E]/g, ' ')
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"');
  res.setHeader(
    'WWW-Authenticate',
    `Bearer realm="visibilio-mcp", resource_metadata="${resourceMetadata}", error="${sanitize(options.error)}", error_description="${sanitize(options.description)}"`
  );
}
