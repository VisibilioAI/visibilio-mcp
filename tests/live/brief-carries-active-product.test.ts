import { describe, it, expect } from 'vitest';
import { connectLiveMcp, liveFixture } from './_live-client.js';

function briefIdOf(createBriefText: string): number {
  const match = /brief_id: (\d+)/.exec(createBriefText);
  if (!match?.[1]) {
    throw new Error(`create_brief returned no brief_id: ${createBriefText}`);
  }
  return Number(match[1]);
}

describe('J1: a brief created through the MCP belongs to the active product', () => {
  it('get_brief reports the product that was active when create_brief ran', async () => {
    const fixture = liveFixture();
    const mcp = await connectLiveMcp(fixture);
    try {
      await mcp.call('set_active_product', { product_id: fixture.productId });
      const created = await mcp.call('create_brief', {
        title: `J1 live journey ${new Date().toISOString()}`,
        content_type: 'article',
        topic: 'visibilio-mcp live journey J1. Safe to delete.',
      });
      const briefId = briefIdOf(created);
      try {
        const brief = await mcp.call('get_brief', { brief_id: briefId });
        expect(brief).toContain(`product_id: ${fixture.productId}`);
      } finally {
        await mcp.call('delete_brief', { brief_id: briefId });
      }
    } finally {
      await mcp.close();
    }
  });
});
