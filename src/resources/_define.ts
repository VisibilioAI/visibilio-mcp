import type { McpSession } from '../session.js';
import spec from '../../spec/mcp-tools.json' with { type: 'json' };

export interface ResourceDescriptor {
  name: string;
  uri: string;
  mimeType: string;
  description: string;
  read: (session: McpSession) => Promise<{ uri: string; mimeType: string; text: string }>;
}

export class NotImplementedError extends Error {
  constructor(resourceName: string) {
    super(`Resource "${resourceName}" handler is not implemented yet (Phase 2 work).`);
    this.name = 'NotImplementedError';
  }
}

interface SpecResource {
  name: string;
  module: string;
  args: string[];
  docstring: string;
  knowledgeDomain?: string;
}

const resourceByName = new Map<string, SpecResource>(
  (spec.resources as SpecResource[]).map((r) => [r.name, r])
);

export function defineResource(name: string, read: ResourceDescriptor['read']): ResourceDescriptor {
  const meta = resourceByName.get(name);
  if (!meta) {
    throw new Error(`No spec entry for resource "${name}" — check spec/mcp-tools.json`);
  }
  return {
    name,
    uri: `visibilio://${name}`,
    mimeType: 'application/json',
    description: meta.docstring.trim() || name,
    read,
  };
}

export function stubResource(name: string): ResourceDescriptor {
  return defineResource(name, async () => {
    throw new NotImplementedError(name);
  });
}
