import { z } from 'zod';

const CREDENTIAL_PATTERN = /^(vsk_|vat_)/;
const CREDENTIAL_MESSAGE =
  'Credential must start with vsk_ or vat_ (personal API key or OAuth access token)';
const DEFAULT_GATEWAY_URL = 'https://visibilio-api-gateway-prod.vercel.app';

const baseSchema = z.object({
  gatewayUrl: z.string().url(),
  frontendUrl: z.string().url().optional(),
  timeoutMs: z.number().int().positive().default(30_000),
});

const settingsSchema = baseSchema.extend({
  credential: z.string().regex(CREDENTIAL_PATTERN, CREDENTIAL_MESSAGE),
});

export type BaseSettings = z.infer<typeof baseSchema>;
export type Settings = z.infer<typeof settingsSchema>;

function readBase(env: NodeJS.ProcessEnv) {
  return {
    gatewayUrl: env.VISIBILIO_GATEWAY_URL ?? DEFAULT_GATEWAY_URL,
    frontendUrl: env.VISIBILIO_FRONTEND_URL,
    timeoutMs: env.VISIBILIO_TIMEOUT_MS ? Number(env.VISIBILIO_TIMEOUT_MS) : undefined,
  };
}

function formatIssues(error: z.ZodError): string {
  return error.issues.map((i) => `  • ${i.path.join('.')}: ${i.message}`).join('\n');
}

export function loadSettings(env: NodeJS.ProcessEnv = process.env): Settings {
  if (!env.VISIBILIO_API_KEY) {
    throw new Error('VISIBILIO_API_KEY is required (a vsk_ API key or a vat_ OAuth access token)');
  }
  const parsed = settingsSchema.safeParse({ ...readBase(env), credential: env.VISIBILIO_API_KEY });
  if (!parsed.success) {
    throw new Error(`Invalid Visibilio MCP configuration:\n${formatIssues(parsed.error)}`);
  }
  return parsed.data;
}

export function loadBaseSettings(env: NodeJS.ProcessEnv = process.env): BaseSettings {
  const parsed = baseSchema.safeParse(readBase(env));
  if (!parsed.success) {
    throw new Error(`Invalid Visibilio MCP base configuration:\n${formatIssues(parsed.error)}`);
  }
  return parsed.data;
}

export function withCredential(base: BaseSettings, credential: string): Settings {
  const parsed = settingsSchema.safeParse({ ...base, credential });
  if (!parsed.success) {
    throw new Error(`Invalid credential:\n${formatIssues(parsed.error)}`);
  }
  return parsed.data;
}
