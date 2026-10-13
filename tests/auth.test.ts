import { describe, it, expect, vi } from 'vitest';
import { McpAuth, AuthenticationError } from '../src/auth.js';

interface FakeResponseSpec {
  status: number;
  body: unknown;
}

function fakeFetch(spec: FakeResponseSpec) {
  return vi.fn(async (_url: string, _init?: RequestInit) => ({
    ok: spec.status >= 200 && spec.status < 300,
    status: spec.status,
    headers: { get: () => null },
    text: async () => JSON.stringify(spec.body),
    json: async () => spec.body,
  })) as unknown as typeof fetch;
}

function meResponse(overrides: Record<string, unknown> = {}) {
  return {
    user: { id: 42, email: 'owner@example.com', name: 'Owner Example', short_id: 'u42' },
    organizations: [
      { id: 158, name: 'Visibilio', role: 'owner' },
      { id: 160, name: 'Second Org', role: 'member' },
    ],
    default_organization_id: 158,
    ...overrides,
  };
}

function buildAuth(credential: string, fetchImpl: typeof fetch) {
  return new McpAuth({ credential, gatewayUrl: 'https://gateway.test/', fetch: fetchImpl });
}

describe('McpAuth.resolve — identity comes from the gateway /auth/me', () => {
  it('resolves a vsk_ key into the user, their organizations and the default organization', async () => {
    const fetchImpl = fakeFetch({ status: 200, body: meResponse() });

    const ctx = await buildAuth('vsk_abc', fetchImpl).resolve();

    expect(ctx).toEqual({
      userId: 42,
      email: 'owner@example.com',
      name: 'Owner Example',
      organizationId: 158,
      organizations: [
        { id: 158, name: 'Visibilio', role: 'owner' },
        { id: 160, name: 'Second Org', role: 'member' },
      ],
    });
  });

  it('calls GET {gateway}/api/v2/auth/me with the credential as a Bearer token', async () => {
    const fetchImpl = fakeFetch({ status: 200, body: meResponse() });

    await buildAuth('vsk_abc', fetchImpl).resolve();

    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe('https://gateway.test/api/v2/auth/me');
    expect((init as RequestInit).method ?? 'GET').toBe('GET');
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer vsk_abc' });
  });

  it('accepts a vat_ OAuth access token through the same endpoint', async () => {
    const fetchImpl = fakeFetch({ status: 200, body: meResponse() });

    const ctx = await buildAuth('vat_token', fetchImpl).resolve();

    expect(ctx.userId).toBe(42);
    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer vat_token' });
  });

  it('falls back to the first organization when the gateway reports no default', async () => {
    const fetchImpl = fakeFetch({ status: 200, body: meResponse({ default_organization_id: null }) });

    const ctx = await buildAuth('vsk_abc', fetchImpl).resolve();

    expect(ctx.organizationId).toBe(158);
  });

  it('caches the resolved context so a session authenticates once', async () => {
    const fetchImpl = fakeFetch({ status: 200, body: meResponse() });
    const auth = buildAuth('vsk_abc', fetchImpl);

    const first = await auth.resolve();
    const second = await auth.resolve();

    expect(second).toBe(first);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects an unknown credential format before contacting the gateway', async () => {
    const fetchImpl = fakeFetch({ status: 200, body: meResponse() });

    await expect(buildAuth('sk-not-ours', fetchImpl).resolve()).rejects.toMatchObject({
      name: 'AuthenticationError',
      status: 401,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('maps a gateway 401 to AuthenticationError(401)', async () => {
    const fetchImpl = fakeFetch({ status: 401, body: { error: 'Unauthorized' } });

    await expect(buildAuth('vsk_revoked', fetchImpl).resolve()).rejects.toBeInstanceOf(
      AuthenticationError
    );
    await expect(buildAuth('vsk_revoked', fetchImpl).resolve()).rejects.toMatchObject({
      status: 401,
    });
  });

  it('maps a gateway 403 (insufficient scope) to AuthenticationError(403)', async () => {
    const fetchImpl = fakeFetch({ status: 403, body: { error: 'insufficient_scope' } });

    await expect(buildAuth('vsk_ingest_only', fetchImpl).resolve()).rejects.toMatchObject({
      status: 403,
    });
  });

  it('maps a gateway 5xx to AuthenticationError(502) so callers can distinguish outage from bad key', async () => {
    const fetchImpl = fakeFetch({ status: 500, body: { error: 'boom' } });

    await expect(buildAuth('vsk_abc', fetchImpl).resolve()).rejects.toMatchObject({ status: 502 });
  });

  it('rejects a user without any organization', async () => {
    const fetchImpl = fakeFetch({
      status: 200,
      body: meResponse({ organizations: [], default_organization_id: null }),
    });

    await expect(buildAuth('vsk_abc', fetchImpl).resolve()).rejects.toMatchObject({ status: 403 });
  });
});
