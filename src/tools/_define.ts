import type { ZodRawShape } from 'zod';
import type { McpSession } from '../session.js';
import { HttpError } from '../client.js';

export interface ToolAnnotations {
  readonly readOnlyHint: boolean;
  readonly destructiveHint: boolean;
  readonly idempotentHint?: boolean;
}

export type ToolArgs = Record<string, unknown>;

export interface StructuredResult {
  readonly structuredContent: Record<string, unknown>;
}

export type ToolOutput = string | StructuredResult;
export type ToolHandler = (args: ToolArgs, session: McpSession) => Promise<ToolOutput>;

export interface CallToolResult {
  [key: string]: unknown;
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Record<string, unknown>;
}

/** A plain string becomes one text item; a structured result also carries the same JSON as text (ChatGPT reads both). */
export function toCallToolResult(output: ToolOutput): CallToolResult {
  if (typeof output === 'string') return { content: [{ type: 'text', text: output }] };
  return {
    content: [{ type: 'text', text: JSON.stringify(output.structuredContent) }],
    structuredContent: output.structuredContent,
  };
}

export interface ToolDefinition<TShape extends ZodRawShape = ZodRawShape> {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: TShape;
  readonly annotations: ToolAnnotations;
  readonly handler: ToolHandler;
}

interface DefineToolInput<TShape extends ZodRawShape> {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: TShape;
  readonly annotations: ToolAnnotations;
  readonly handler: ToolHandler;
}

export const readOnly: ToolAnnotations = { readOnlyHint: true, destructiveHint: false };
export const mutating: ToolAnnotations = { readOnlyHint: false, destructiveHint: false };
export const destructive: ToolAnnotations = { readOnlyHint: false, destructiveHint: true };

export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolError';
  }
}

export function defineTool<TShape extends ZodRawShape>(
  input: DefineToolInput<TShape>
): ToolDefinition<TShape> {
  return {
    name: input.name,
    title: input.title,
    description: input.description,
    inputSchema: input.inputSchema,
    annotations: input.annotations,
    handler: async (args, session) => {
      try {
        return await input.handler(args ?? {}, session);
      } catch (err) {
        if (err instanceof ToolError) return `Error: ${err.message}`;
        if (err instanceof HttpError) return describeError(`${input.title} failed`, err);
        throw err;
      }
    },
  };
}

export function describeError(prefix: string, err: unknown): string {
  if (err instanceof HttpError) {
    return `${prefix} (HTTP ${err.status}): ${describeBody(err.body)}`;
  }
  return `${prefix}: ${err instanceof Error ? err.message : String(err)}`;
}

function describeBody(body: unknown): string {
  if (typeof body === 'string') return body;
  if (body && typeof body === 'object') {
    const obj = body as Record<string, unknown>;
    for (const key of ['message', 'error', 'detail']) {
      const value = obj[key];
      if (typeof value === 'string') return value;
      if (value && typeof value === 'object') {
        const nested = value as Record<string, unknown>;
        if (typeof nested.message === 'string') return nested.message;
      }
    }
  }
  return JSON.stringify(body ?? null);
}

export function isNotFound(err: unknown): boolean {
  return err instanceof HttpError && err.status === 404;
}

export function unwrapData<T>(body: unknown): T {
  if (body && typeof body === 'object' && 'data' in (body as Record<string, unknown>)) {
    return (body as { data: T }).data;
  }
  return body as T;
}

export function toJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function numberArg(args: ToolArgs, key: string): number | undefined {
  const value = args[key];
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed))
    throw new ToolError(`${key} must be a number (got "${String(value)}")`);
  return parsed;
}

export function requireNumberArg(args: ToolArgs, key: string): number {
  const value = numberArg(args, key);
  if (value === undefined) throw new ToolError(`${key} is required`);
  return value;
}

export function stringArg(args: ToolArgs, key: string): string | undefined {
  const value = args[key];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function requireStringArg(args: ToolArgs, key: string): string {
  const value = stringArg(args, key);
  if (value === undefined) throw new ToolError(`${key} is required`);
  return value;
}

export function booleanArg(args: ToolArgs, key: string): boolean | undefined {
  const value = args[key];
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

export function pick(args: ToolArgs, keys: readonly string[]): ToolArgs {
  const out: ToolArgs = {};
  for (const key of keys) {
    if (args[key] !== undefined && args[key] !== null) out[key] = args[key];
  }
  return out;
}

export function resolveProductId(args: ToolArgs, session: McpSession): number {
  const explicit = numberArg(args, 'product_id');
  if (explicit !== undefined) return explicit;
  if (session.productId !== null) return session.productId;
  throw new ToolError(
    'No active product. Call list_products, then set_active_product (or pass product_id).'
  );
}

export function optionalProductId(args: ToolArgs, session: McpSession): number | undefined {
  return numberArg(args, 'product_id') ?? session.productId ?? undefined;
}
