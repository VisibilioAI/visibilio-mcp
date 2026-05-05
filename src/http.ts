import { loadBaseSettings } from './config.js';
import { buildHttpApp } from './http-app.js';

const PORT = Number(process.env.PORT ?? 8080);

async function main(): Promise<void> {
  const baseSettings = loadBaseSettings();
  const { app, sessions } = buildHttpApp({ baseSettings });

  const server = app.listen(PORT, () => {
    console.error(`[visibilio-mcp/http] listening on :${PORT}`);
  });

  // Cloud Run sends SIGTERM on scale-down; drain sessions then exit.
  const shutdown = async (signal: string) => {
    console.error(
      `[visibilio-mcp/http] received ${signal}, draining ${sessions.size} session(s)...`
    );
    server.close();
    for (const transport of sessions.values()) {
      await transport.close().catch(() => undefined);
    }
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[visibilio-mcp/http] fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
