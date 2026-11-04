import { describe, it, expect, vi } from 'vitest';
import { HttpError, type VisibilioClient } from '../src/client.js';
import { rememberContext } from '../src/remembered-context.js';
import type { SessionContext } from '../src/session.js';

const CONTEXT: SessionContext = { organizationId: 2, product: null };

function clientRejectingPutWith(error: unknown): VisibilioClient {
  return {
    put: vi.fn(async () => {
      throw error;
    }),
  } as unknown as VisibilioClient;
}

describe('rememberContext — best-effort cache, except an org-scoping rejection must surface', () => {
  it('re-throws an oauth_organization_scoped 403 so the rejected switch cannot silently stand', async () => {
    const client = clientRejectingPutWith(
      new HttpError('PUT /api/v2/mcp/context → 403', 403, {
        error: 'oauth_organization_scoped',
        grant_organization_id: 1,
      })
    );

    await expect(rememberContext(client, CONTEXT)).rejects.toBeInstanceOf(HttpError);
  });

  it('swallows a non-scoped 403 — a different forbidden reason keeps the best-effort path', async () => {
    // Regression guard — already passes; locks in that only oauth_organization_scoped re-throws.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const client = clientRejectingPutWith(
      new HttpError('PUT /api/v2/mcp/context → 403', 403, { error: 'forbidden' })
    );

    await expect(rememberContext(client, CONTEXT)).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('swallows a transient 500 — a server error keeps the best-effort path', async () => {
    // Regression guard — already passes; locks in that non-enforcement failures never throw.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const client = clientRejectingPutWith(
      new HttpError('PUT /api/v2/mcp/context → 500', 500, { error: 'server_error' })
    );

    await expect(rememberContext(client, CONTEXT)).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
