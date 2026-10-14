import { describe, it, expect } from 'vitest';
import { buildSession, pathMatcher } from './_helpers.js';
import { allResources } from '../../src/resources/index.js';

function resource(uri: string) {
  const found = allResources.find((r) => r.uri === uri);
  if (!found) throw new Error(`resource ${uri} not registered`);
  return found;
}

describe('resources', () => {
  it('visibilio://organization describes the user, the active organization and the active product', async () => {
    const { session } = buildSession([]);
    await session.setActiveProduct(147, 'Visibilio');

    const text = await resource('visibilio://organization').read(session);

    expect(text).toContain('owner@example.com');
    expect(text).toContain('Primary Org');
    expect(text).toContain('organization_id: 7');
    expect(text).toContain('product_id: 147');
  });

  it('visibilio://product reads the active product from the gateway', async () => {
    const { session } = buildSession([
      {
        match: pathMatcher('GET', '/api/v2/products/147'),
        body: { data: { id: 147, name: 'Visibilio', description: 'AI content platform' } },
      },
    ]);
    await session.setActiveProduct(147, 'Visibilio');

    const text = await resource('visibilio://product').read(session);

    expect(text).toContain('AI content platform');
  });

  it('visibilio://product explains how to pick a product when none is active', async () => {
    const { session, calls } = buildSession([]);

    const text = await resource('visibilio://product').read(session);

    expect(text).toContain('set_active_product');
    expect(calls).toHaveLength(0);
  });

  it('visibilio://knowledge/{domain} reads the product-scoped domain', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('GET', '/api/v2/products/147/knowledge/market_intelligence'),
        body: {
          data: {
            domain: 'market_intelligence',
            content: { competitors: ['Jasper'] },
            version: { version_number: 2 },
          },
        },
      },
    ]);
    await session.setActiveProduct(147, 'Visibilio');

    const text = await resource('visibilio://knowledge/market_intelligence').read(session);

    expect(calls[0]!.url).toContain('/api/v2/products/147/knowledge/market_intelligence');
    expect(text).toContain('Jasper');
  });

  it('knowledge resources carry a JSON mime type', () => {
    expect(resource('visibilio://knowledge/company_profile').mimeType).toBe('application/json');
  });
});
