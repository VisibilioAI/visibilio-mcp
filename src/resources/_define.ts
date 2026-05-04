import type { McpSession } from '../session.js';
import spec from '../../spec/mcp-tools.json' with { type: 'json' };

export interface ResourceContent {
  uri: string;
  mimeType: string;
  text: string;
}

export interface ResourceDescriptor {
  name: string;
  uri: string;
  mimeType: string;
  description: string;
  read: (session: McpSession) => Promise<ResourceContent>;
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

export function defineResource(
  name: string,
  read: (session: McpSession) => Promise<string>
): ResourceDescriptor {
  const meta = resourceByName.get(name);
  if (!meta) {
    throw new Error(`No spec entry for resource "${name}" — check spec/mcp-tools.json`);
  }
  const uri = `visibilio://${name}`;
  const mimeType = 'text/plain';
  return {
    name,
    uri,
    mimeType,
    description: meta.docstring.trim() || name,
    read: async (session) => ({
      uri,
      mimeType,
      text: await read(session),
    }),
  };
}

export function stubResource(name: string): ResourceDescriptor {
  return defineResource(name, async () => {
    throw new NotImplementedError(name);
  });
}
