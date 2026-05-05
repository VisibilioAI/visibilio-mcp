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

  const sessions = new Map<string, SSEServerTransport>();

  // Note: /healthz is reserved by Google Cloud Run's frontend and is
  // intercepted before reaching the container — GFE returns its own
  // branded 404. Use /health for health checks instead.
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: '@visibilio/mcp', sessions: sessions.size });
  });

  app.get('/sse', async (req: Request, res: Response) => {
    const apiKey = extractBearer(req);
    if (!apiKey) {
      res
        .status(401)
        .json({ error: 'missing_authorization', message: 'Authorization: Bearer vsk_...' });
      return;
    }

    let settings;
    try {
      settings = withApiKey(baseSettings, apiKey);
    } catch {
      res.status(401).json({ error: 'invalid_api_key', message: 'API key must start with vsk_' });
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
