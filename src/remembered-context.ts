import type { VisibilioClient } from './client.js';
import type { SessionContext } from './session.js';

/**
 * The user's last active organization and product, kept by the gateway at
 * /api/v2/mcp/context so that a server restart (a deploy, or Cloud Run replacing
 * the instance) does not drop the user back into their home organization
 * (meta#785).
 *
 * Best effort both ways. A gateway without the route, or any failure, reads as
 * nothing remembered, and a failed write is logged while the switch still
 * stands, so the server behaves as it did before the route existed.
 */
const CONTEXT_PATH = '/api/v2/mcp/context';

interface RememberedContextBody {
  data?: {
    organization_id?: unknown;
    product_id?: unknown;
    product_name?: unknown;
  } | null;
}

export async function loadRememberedContext(
  client: VisibilioClient
): Promise<SessionContext | undefined> {
  try {
    const body = (await client.get(CONTEXT_PATH)) as RememberedContextBody | null;
    const data = body?.data;
    if (!data || typeof data.organization_id !== 'number') return undefined;
    return {
      organizationId: data.organization_id,
      product:
        typeof data.product_id === 'number'
          ? {
              id: data.product_id,
              name: typeof data.product_name === 'string' ? data.product_name : null,
            }
          : null,
    };
  } catch {
    return undefined;
  }
}

export async function rememberContext(
  client: VisibilioClient,
  context: SessionContext
): Promise<void> {
  try {
    await client.put(CONTEXT_PATH, {
      organization_id: context.organizationId,
      product_id: context.product?.id ?? null,
    });
  } catch (err) {
    console.error(
      '[visibilio-mcp/context] could not save the session context:',
      err instanceof Error ? err.message : err
    );
  }
}
