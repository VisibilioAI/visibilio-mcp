import type { McpSession } from '../session.js';
import spec from '../../spec/mcp-tools.json' with { type: 'json' };

export interface JsonSchema {
  type: 'object';
  properties: Record<string, { type: string; description?: string }>;
  required?: string[];
  additionalProperties?: boolean;
}

export type ToolHandler = (args: Record<string, unknown>, session: McpSession) => Promise<unknown>;

export interface ToolDescriptor {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  handler: ToolHandler;
}

export class NotImplementedError extends Error {
  constructor(toolName: string) {
    super(`Tool "${toolName}" handler is not implemented yet (Phase 2 work).`);
    this.name = 'NotImplementedError';
  }
}

interface SpecTool {
  name: string;
  module: string;
  args: string[];
  docstring: string;
}

const toolByName = new Map<string, SpecTool>((spec.tools as SpecTool[]).map((t) => [t.name, t]));

export function defineTool(name: string, handler: ToolHandler): ToolDescriptor {
  const meta = toolByName.get(name);
  if (!meta) {
    throw new Error(`No spec entry for tool "${name}" — check spec/mcp-tools.json`);
  }
  return {
    name,
    description: meta.docstring.trim() || name,
    inputSchema: argsToJsonSchema(meta.args),
    handler,
  };
}

export function stubTool(name: string): ToolDescriptor {
  return defineTool(name, async () => {
    throw new NotImplementedError(name);
  });
}

function argsToJsonSchema(args: string[]): JsonSchema {
  const properties: JsonSchema['properties'] = {};
  for (const arg of args) {
    properties[arg] = { type: 'string' };
  }
  return {
    type: 'object',
    properties,
    required: [],
    additionalProperties: false,
  };
}
