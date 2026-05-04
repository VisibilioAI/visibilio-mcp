import express, { type Request, type Response } from 'express';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { buildServer } from './server.js';
import { loadSettings } from './config.js';

const PORT = Number(process.env.PORT ?? 8787);

async function main(): Promise<void> {
  loadSettings();

  const app = express();
  const sessions = new Map<string, SSEServerTransport>();

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: '@visibilio/mcp' });
  });

  app.get('/sse', async (req: Request, res: Response) => {
    const apiKey = extractBearer(req);
    if (!apiKey) {
      res.status(401).json({ error: 'missing Authorization: Bearer vsk_...' });
      return;
    }
    const settings = loadSettings({ ...process.env, VISIBILIO_API_KEY: apiKey });
    try {
      const transport = new SSEServerTransport('/messages', res);
      const { server } = await buildServer({ settings });
      sessions.set(transport.sessionId, transport);
      res.on('close', () => sessions.delete(transport.sessionId));
      await server.connect(transport);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error';
      res.status(500).json({ error: message });
    }
  });

  app.post('/messages', async (req: Request, res: Response) => {
    const sessionId = req.query.sessionId as string | undefined;
    const transport = sessionId ? sessions.get(sessionId) : undefined;
    if (!transport) {
      res.status(404).json({ error: 'session not found' });
      return;
    }
    await transport.handlePostMessage(req, res);
  });

  app.listen(PORT, () => {
    console.error(`[visibilio-mcp] HTTP/SSE listening on :${PORT}`);
  });
}

function extractBearer(req: Request): string | null {
  const header = req.header('authorization');
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1] ?? null;
}

main().catch((err) => {
  console.error('[visibilio-mcp] http fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
