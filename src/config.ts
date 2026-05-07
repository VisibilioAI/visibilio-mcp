import { z } from 'zod';

const baseSchema = z.object({
  backendUrl: z.string().url(),
  gatewayUrl: z.string().url(),
  internalApiKey: z.string().optional(),
  timeoutMs: z.number().int().positive().default(30_000),
  // OAuth introspection client credentials. When set, the MCP server
  // will resolve Bearer vat_* tokens via /api/v2/oauth/introspect on
  // the gateway. Without these, only vsk_* API keys work.
  oauthClientId: z.string().optional(),
  oauthClientSecret: z.string().optional(),
});

const settingsSchema = baseSchema.extend({
  apiKey: z.string().regex(/^(vsk_|vat_)/, 'API key must start with vsk_ or vat_'),
});

export type BaseSettings = z.infer<typeof baseSchema>;
export type Settings = z.infer<typeof settingsSchema>;

function readBase(env: NodeJS.ProcessEnv) {
  return {
    backendUrl: env.VISIBILIO_BACKEND_URL ?? 'https://api.visibilio.ai',
    gatewayUrl: env.VISIBILIO_GATEWAY_URL ?? 'https://gateway.visibilio.ai',
    internalApiKey: env.VISIBILIO_INTERNAL_API_KEY,
    timeoutMs: env.VISIBILIO_TIMEOUT_MS ? Number(env.VISIBILIO_TIMEOUT_MS) : undefined,
    oauthClientId: env.VISIBILIO_OAUTH_CLIENT_ID,
    oauthClientSecret: env.VISIBILIO_OAUTH_CLIENT_SECRET,
  };
}

function formatIssues(error: z.ZodError): string {
  return error.issues.map((i) => `  • ${i.path.join('.')}: ${i.message}`).join('\n');
}

/**
 * Stdio mode: requires VISIBILIO_API_KEY in env.
 */
export function loadSettings(env: NodeJS.ProcessEnv = process.env): Settings {
  const parsed = settingsSchema.safeParse({ ...readBase(env), apiKey: env.VISIBILIO_API_KEY });
  if (!parsed.success) {
    throw new Error(`Invalid Visibilio MCP configuration:\n${formatIssues(parsed.error)}`);
  }
  return parsed.data;
}

/**
 * HTTP mode: API key comes from per-request Authorization header,
 * not from process env. This validates only the backend/gateway URLs
 * and timeout at startup.
 */
export function loadBaseSettings(env: NodeJS.ProcessEnv = process.env): BaseSettings {
  const parsed = baseSchema.safeParse(readBase(env));
  if (!parsed.success) {
    throw new Error(`Invalid Visibilio MCP base configuration:\n${formatIssues(parsed.error)}`);
  }
  return parsed.data;
}

/**
 * Build full Settings from base + a runtime API key (used per-request in HTTP mode).
 */
export function withApiKey(base: BaseSettings, apiKey: string): Settings {
  const parsed = settingsSchema.safeParse({ ...base, apiKey });
  if (!parsed.success) {
    throw new Error(`Invalid API key:\n${formatIssues(parsed.error)}`);
  }
  return parsed.data;
}
