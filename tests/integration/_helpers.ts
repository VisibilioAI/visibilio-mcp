import { vi } from 'vitest';
import type { AuthContext } from '../../src/auth.js';
import { VisibilioClient } from '../../src/client.js';
import { McpSession } from '../../src/session.js';

export interface MockResponse {
  match: (url: string, init?: RequestInit) => boolean;
  status?: number;
  body: unknown;
  headers?: Record<string, string>;
}

export function buildSession(responses: MockResponse[], authOverrides?: Partial<AuthContext>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let cursor = 0;
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const matched = responses[cursor] ?? responses.find((r) => r.match(url, init));
    if (matched && responses[cursor] === matched) cursor += 1;
    if (!matched || !matched.match(url, init)) {
      throw new Error(`No mock matched ${init?.method ?? 'GET'} ${url}`);
    }
    const status = matched.status ?? 200;
    const ok = status >= 200 && status < 300;
    const text = matched.body === undefined ? '' : JSON.stringify(matched.body);
    const headerMap = matched.headers ?? {};
    return {
      ok,
      status,
      headers: {
        get: (name: string) => headerMap[name] ?? headerMap[name.toLowerCase()] ?? null,
      },
      text: async () => text,
      json: async () => matched.body,
    } as unknown as Response;
  });

  const auth: AuthContext = {
    userId: 42,
    email: 'owner@example.com',
    name: 'Owner Example',
    organizationId: 7,
    organizations: [
      { id: 7, name: 'Primary Org', role: 'owner' },
      { id: 8, name: 'Second Org', role: 'member' },
    ],
    ...authOverrides,
  };

  const client = new VisibilioClient({
    gatewayUrl: 'https://gateway.test',
    credential: 'vsk_mock',
    fetch: fetchImpl as unknown as typeof fetch,
  });

  const session = new McpSession(auth, client);
  return { session, fetch: fetchImpl, calls };
}

export function pathMatcher(method: string, pathSubstring: string): MockResponse['match'] {
  return (url, init) => {
    const m = (init?.method ?? 'GET').toUpperCase();
    return m === method.toUpperCase() && url.includes(pathSubstring);
  };
}

export function jsonBodyOf(call: { init?: RequestInit } | undefined): Record<string, unknown> {
  if (!call?.init?.body) return {};
  return JSON.parse(String(call.init.body)) as Record<string, unknown>;
}

export function findTool(name: string) {
  return import('../../src/tools/index.js').then(({ allTools }) => {
    const tool = allTools.find((t) => t.name === name);
    if (!tool) throw new Error(`tool ${name} not registered`);
    return tool;
  });
}
