import { z } from 'zod';

const settingsSchema = z.object({
  apiKey: z.string().regex(/^vsk_/, 'VISIBILIO_API_KEY must start with vsk_'),
  backendUrl: z.string().url(),
  gatewayUrl: z.string().url(),
  internalApiKey: z.string().optional(),
  timeoutMs: z.number().int().positive().default(30_000),
});

export type Settings = z.infer<typeof settingsSchema>;

export function loadSettings(env: NodeJS.ProcessEnv = process.env): Settings {
  const parsed = settingsSchema.safeParse({
    apiKey: env.VISIBILIO_API_KEY,
    backendUrl: env.VISIBILIO_BACKEND_URL ?? 'https://api.visibilio.ai',
    gatewayUrl: env.VISIBILIO_GATEWAY_URL ?? 'https://gateway.visibilio.ai',
    internalApiKey: env.VISIBILIO_INTERNAL_API_KEY,
    timeoutMs: env.VISIBILIO_TIMEOUT_MS ? Number(env.VISIBILIO_TIMEOUT_MS) : undefined,
  });
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  • ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid Visibilio MCP configuration:\n${issues}`);
  }
  return parsed.data;
}
