import { vi } from 'vitest';
import { McpAuth, type AuthContext } from '../../src/auth.js';
import { VisibilioClient } from '../../src/client.js';
import { McpSession } from '../../src/session.js';

export interface MockResponse {
  match: (url: string, init?: RequestInit) => boolean;
  status?: number;
  body: unknown;
}

export function buildSession(responses: MockResponse[], authOverrides?: Partial<AuthContext>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const matched = responses.find((r) => r.match(url, init));
    if (!matched) {
      throw new Error(`No mock matched ${init?.method ?? 'GET'} ${url}`);
    }
    const status = matched.status ?? 200;
    const ok = status >= 200 && status < 300;
    const text = matched.body === undefined ? '' : JSON.stringify(matched.body);
    return {
      ok,
      status,
      text: async () => text,
      json: async () => matched.body,
    } as Response;
  });

  const auth: AuthContext = {
    userId: 42,
    organizationId: 7,
    defaultProjectId: null,
    subscriptionTier: 'pro',
    scopes: ['mcp:read', 'mcp:write'],
    ...authOverrides,
  };

  const client = new VisibilioClient({
    backendUrl: 'https://backend.test',
    gatewayUrl: 'https://gateway.test',
    userApiKey: 'vsk_mock',
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

export { McpAuth };
