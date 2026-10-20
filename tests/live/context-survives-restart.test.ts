import { describe, it, expect } from 'vitest';
import {
  connectLiveHttpMcp,
  liveFixture,
  startLiveHttpServer,
  type LiveFixture,
  type LiveMcp,
} from './_live-client.js';

async function onFreshServer<T>(
  fixture: LiveFixture,
  use: (mcp: LiveMcp) => Promise<T>
): Promise<T> {
  const server = await startLiveHttpServer(fixture);
  try {
    const mcp = await connectLiveHttpMcp(server, fixture);
    try {
      return await use(mcp);
    } finally {
      await mcp.close();
    }
  } finally {
    await server.stop();
  }
}

describe('J3: the hosted server keeps the active context across a restart', () => {
  it('a fresh server resumes the product that the previous server set, and a cleared product stays cleared', async () => {
    const fixture = liveFixture();

    await onFreshServer(fixture, (mcp) =>
      mcp.call('set_active_organization', { organization_id: fixture.organizationId })
    );

    const afterClear = await onFreshServer(fixture, async (mcp) => {
      const context = await mcp.call('whoami');
      await mcp.call('set_active_product', { product_id: fixture.productId });
      return context;
    });
    expect(activeProductLine(afterClear)).toMatch(/^Active product: none/);

    const afterSet = await onFreshServer(fixture, (mcp) => mcp.call('whoami'));
    expect(activeProductLine(afterSet)).toContain(`(product_id: ${fixture.productId})`);
  });
});

function activeProductLine(whoami: string): string {
  return (
    whoami.split('\n').find((line) => line.startsWith('Active product:')) ??
    'whoami printed no "Active product:" line'
  );
}
