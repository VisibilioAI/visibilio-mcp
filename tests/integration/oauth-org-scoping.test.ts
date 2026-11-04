import { describe, it, expect, vi } from 'vitest';
import type { AuthContext, OrganizationMembership } from '../../src/auth.js';
import { HttpError, VisibilioClient } from '../../src/client.js';
import { McpSession, type SessionContext } from '../../src/session.js';
import { rememberContext } from '../../src/remembered-context.js';
import { callTool, textOf } from './_helpers.js';

const CONTEXT_PATH = '/api/v2/mcp/context';

interface RejectWith {
  readonly status?: number;
  readonly body?: unknown;
}

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

const SCOPED_403: RejectWith = {
  status: 403,
  body: { error: 'oauth_organization_scoped', grant_organization_id: 1 },
};

function makeScopedClient(reject: RejectWith): {
  client: VisibilioClient;
  calls: Array<{ url: string; init?: RequestInit }>;
} {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = new URL(url).pathname;
    if (path === CONTEXT_PATH && method === 'PUT') {
      return mockResponse(reject.status ?? 403, reject.body);
    }
    return mockResponse(200, { data: {} });
  });
  const client = new VisibilioClient({
    gatewayUrl: 'https://gateway.test',
    credential: 'vat_scoped_mock',
    fetch: fetchImpl as unknown as typeof fetch,
  });
  return { client, calls };
}

function buildScopedSession(
  options: { initialContext?: SessionContext; rejectWith?: RejectWith } = {}
): ScopedSetup {
  const { client, calls } = makeScopedClient(options.rejectWith ?? SCOPED_403);
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

function buildSessionThroughRememberContext(
  options: { rejectWith?: RejectWith } = {}
): ScopedSetup {
  const { client, calls } = makeScopedClient(options.rejectWith ?? SCOPED_403);
  const session = new McpSession(makeAuth(), client, {
    onContextChange: (context) => rememberContext(client, context),
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

describe('set_active_organization surfaces a friendly message for a scoped-switch 403', () => {
  it('names the grant organization and tells the user to re-authorize', async () => {
    const { session } = buildScopedSession();

    const result = await callTool('set_active_organization', { organization_id: 2 }, session);
    const text = textOf(result);

    expect(result.isError).toBe(true);
    expect(text).toContain('scoped to organization');
    expect(text).toContain('Alpha Org');
    expect(text).toContain('re-authorize');
    expect(text).not.toContain('HTTP 403');
  });

  it('falls back to the grant organization id when it is not among the memberships', async () => {
    const { session } = buildScopedSession({
      rejectWith: {
        status: 403,
        body: { error: 'oauth_organization_scoped', grant_organization_id: 999 },
      },
    });

    const result = await callTool('set_active_organization', { organization_id: 2 }, session);
    const text = textOf(result);

    expect(text).toContain('scoped to organization 999');
    expect(text).toContain('re-authorize');
  });

  it('leaves a non-scoped 403 on its existing path — personal-key sessions are unchanged', async () => {
    // Regression guard — already passes; a 403 that is not oauth_organization_scoped must keep
    // the raw gateway-error path and never show the re-authorize message.
    const { session } = buildScopedSession({
      rejectWith: { status: 403, body: { error: 'forbidden', message: 'Forbidden' } },
    });

    const result = await callTool('set_active_organization', { organization_id: 2 }, session);
    const text = textOf(result);

    expect(result.isError).toBe(true);
    expect(text).not.toContain('re-authorize');
    expect(text).toContain('Forbidden');
  });
});

describe('production wiring — set_active_organization through the real rememberContext', () => {
  it('surfaces the friendly message and reverts the switch when the context write is org-scoped', async () => {
    const { session } = buildSessionThroughRememberContext();
    expect(session.organizationId).toBe(1);

    const result = await callTool('set_active_organization', { organization_id: 2 }, session);
    const text = textOf(result);

    expect(result.isError).toBe(true);
    expect(text).toContain('scoped to organization');
    expect(text).toContain('Alpha Org');
    expect(text).toContain('re-authorize');
    expect(session.organizationId).toBe(1);
  });

  it('lets the switch stand on a transient 500 — the best-effort cache is preserved', async () => {
    // Regression guard — a non-enforcement failure must not revert or raise; the switch stands.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { session } = buildSessionThroughRememberContext({
      rejectWith: { status: 500, body: { error: 'server_error' } },
    });

    const result = await callTool('set_active_organization', { organization_id: 2 }, session);
    const text = textOf(result);

    expect(result.isError).toBeUndefined();
    expect(text).toContain('Active organization set to');
    expect(session.organizationId).toBe(2);
    errorSpy.mockRestore();
  });
});
