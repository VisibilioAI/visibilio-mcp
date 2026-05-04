import { describe, it, expect, vi } from 'vitest';
import { McpAuth, AuthenticationError } from '../src/auth.js';

const baseResponse = {
  user_id: 42,
  organization_id: 7,
  default_project_id: null,
  subscription_tier: 'pro',
  scopes: ['mcp:read', 'mcp:write'],
};

function fetchOk(body: Record<string, unknown> = baseResponse): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => body,
  }) as unknown as typeof fetch;
}

function fetchStatus(status: number): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: async () => ({ error: `status ${status}` }),
  }) as unknown as typeof fetch;
}

describe('McpAuth.resolve', () => {
  it('resolves vsk_* key via /api/v2/auth/resolve-key', async () => {
    const fetchImpl = fetchOk();
    const auth = new McpAuth({
      apiKey: 'vsk_test123',
      backendUrl: 'https://backend.example',
      fetch: fetchImpl,
    });
    const ctx = await auth.resolve();
    expect(ctx.userId).toBe(42);
    expect(ctx.organizationId).toBe(7);
    expect(ctx.subscriptionTier).toBe('pro');
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://backend.example/api/v2/auth/resolve-key',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ 'X-API-Key': 'vsk_test123' }),
      })
    );
  });

  it('caches resolved context across multiple calls', async () => {
    const fetchImpl = fetchOk();
    const auth = new McpAuth({
      apiKey: 'vsk_cache',
      backendUrl: 'https://backend.example',
      fetch: fetchImpl,
    });
    await auth.resolve();
    await auth.resolve();
    await auth.resolve();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('throws AuthenticationError on 401', async () => {
    const auth = new McpAuth({
      apiKey: 'vsk_invalid',
      backendUrl: 'https://backend.example',
      fetch: fetchStatus(401),
    });
    await expect(auth.resolve()).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('throws AuthenticationError on 403', async () => {
    const auth = new McpAuth({
      apiKey: 'vsk_revoked',
      backendUrl: 'https://backend.example',
      fetch: fetchStatus(403),
    });
    await expect(auth.resolve()).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('cachedContext throws if not resolved', () => {
    const auth = new McpAuth({
      apiKey: 'vsk_fresh',
      backendUrl: 'https://backend.example',
      fetch: fetchOk(),
    });
    expect(() => auth.cachedContext()).toThrow();
  });

  it('isResolved is false before resolve(), true after', async () => {
    const auth = new McpAuth({
      apiKey: 'vsk_state',
      backendUrl: 'https://backend.example',
      fetch: fetchOk(),
    });
    expect(auth.isResolved()).toBe(false);
    await auth.resolve();
    expect(auth.isResolved()).toBe(true);
  });
});
