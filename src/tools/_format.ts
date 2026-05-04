import { HttpError } from '../client.js';

export function formatHttpError(prefix: string, err: unknown): string {
  if (err instanceof HttpError) {
    return `${prefix} (HTTP ${err.status}): ${describeBody(err.body)}`;
  }
  return `${prefix}: ${err instanceof Error ? err.message : String(err)}`;
}

function describeBody(body: unknown): string {
  if (typeof body === 'string') return body;
  if (body && typeof body === 'object') {
    const obj = body as Record<string, unknown>;
    if (typeof obj.error === 'string') return obj.error;
    if (typeof obj.message === 'string') return obj.message;
    if (typeof obj.detail === 'string') return obj.detail;
  }
  return JSON.stringify(body ?? null);
}

export function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Missing or invalid required argument: ${key}`);
  }
  return value;
}

export function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
