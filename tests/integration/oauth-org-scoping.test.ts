import { describe, it, expect, vi } from 'vitest';
import type { AuthContext, OrganizationMembership } from '../../src/auth.js';
import { HttpError, VisibilioClient } from '../../src/client.js';
import { McpSession, type SessionContext } from '../../src/session.js';

const CONTEXT_PATH = '/api/v2/mcp/context';

interface ScopedSetup {
  readonly session: McpSession;
  readonly client: VisibilioClient;
  readonly calls: Array<{ url: string; init?: RequestInit }>;
}

function makeAuth(): AuthContext {
  const organizations: readonly OrganizationMembership[] = [
    { id: 1, name: 'Alpha Org', role: 'owner' },
    { id: 2, name: 'Beta Org', role: 'member' },
  ];
  return {
    userId: 10,
    email: 'owner@example.com',
    name: 'Owner Example',
    organizationId: 1,
    organizations,
  };
}

function mockResponse(status: number, body: unknown): Response {
  const ok = status >= 200 && status < 300;
  return {
    ok,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response;
}

function buildScopedSession(options: { initialContext?: SessionContext } = {}): ScopedSetup {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = new URL(url).pathname;
    if (path === CONTEXT_PATH && method === 'PUT') {
      return mockResponse(403, { error: 'oauth_organization_scoped', grant_organization_id: 1 });
    }
    return mockResponse(200, { data: {} });
  });

  const client = new VisibilioClient({
    gatewayUrl: 'https://gateway.test',
    credential: 'vat_scoped_mock',
    fetch: fetchImpl as unknown as typeof fetch,
  });

  const session = new McpSession(makeAuth(), client, {
    initialContext: options.initialContext,
    onContextChange: async (context) => {
      await client.put(CONTEXT_PATH, {
        organization_id: context.organizationId,
        product_id: context.product?.id ?? null,
      });
    },
  });
  return { session, client, calls };
}

function lastOrgHeader(calls: ReadonlyArray<{ init?: RequestInit }>): string | null {
  for (let index = calls.length - 1; index >= 0; index -= 1) {
    const headers = calls[index]?.init?.headers as Record<string, string> | undefined;
    if (headers && 'X-Organization-Id' in headers) return headers['X-Organization-Id'] ?? null;
  }
  return null;
}

describe('set_active_organization reverts local state when the gateway rejects the context write', () => {
  it('keeps the previous active organization after an oauth_organization_scoped 403', async () => {
    const { session } = buildScopedSession();
    expect(session.organizationId).toBe(1);

    await expect(session.setActiveOrganization(2)).rejects.toBeInstanceOf(HttpError);

    expect(session.organizationId).toBe(1);
  });

  it('reverts the client organization header so later requests do not leak to the rejected org', async () => {
    const { session, client, calls } = buildScopedSession();

    await expect(session.setActiveOrganization(2)).rejects.toBeInstanceOf(HttpError);
    await client.get('/api/v2/ping');

    expect(lastOrgHeader(calls)).toBe('1');
  });

  it('restores the previously active product', async () => {
    const { session } = buildScopedSession({
      initialContext: { organizationId: 1, product: { id: 99, name: 'Widget' } },
    });
    expect(session.product?.id).toBe(99);

    await expect(session.setActiveOrganization(2)).rejects.toBeInstanceOf(HttpError);

    expect(session.product?.id).toBe(99);
  });
});
