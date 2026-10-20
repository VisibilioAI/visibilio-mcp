import { describe, it, expect } from 'vitest';
import { buildSession, callTool, findTool, jsonBodyOf, pathMatcher, textOf } from './_helpers.js';

const PRODUCT = {
  id: 147,
  organization_id: 7,
  name: 'Visibilio',
  description: 'AI content platform',
  product_type: 'standard',
  is_archived: false,
  supported_languages: ['en', 'bg'],
};

describe('products', () => {
  it('list_products unwraps {data, total} and marks the active product', async () => {
    const { session } = buildSession([
      {
        match: pathMatcher('GET', '/api/v2/products'),
        body: { data: [PRODUCT, { ...PRODUCT, id: 148, name: 'Kondevs' }], total: 2 },
      },
    ]);
    await session.setActiveProduct(148, 'Kondevs');

    const text = await (await findTool('list_products')).handler({}, session);

    expect(text).toContain('Visibilio (product_id: 147)');
    expect(text).toMatch(/Kondevs \(product_id: 148\).*← active/);
  });

  it('set_active_product verifies the product exists and scopes the session', async () => {
    const { session } = buildSession([
      { match: pathMatcher('GET', '/api/v2/products/147'), body: { data: PRODUCT } },
    ]);

    const text = await (await findTool('set_active_product')).handler({ product_id: 147 }, session);

    expect(session.productId).toBe(147);
    expect(text).toContain('Visibilio');
  });

  it('get_product renders the product details', async () => {
    const { session } = buildSession([
      { match: pathMatcher('GET', '/api/v2/products/147'), body: { data: PRODUCT } },
    ]);

    const text = await (await findTool('get_product')).handler({ product_id: 147 }, session);

    expect(text).toContain('AI content platform');
    expect(text).toContain('en, bg');
  });

  it('create_product posts name, description and type', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('POST', '/api/v2/products'),
        status: 201,
        body: { data: { ...PRODUCT, id: 150, name: 'New brand' } },
      },
    ]);

    const text = await (
      await findTool('create_product')
    ).handler({ name: 'New brand', description: 'A brand', product_type: 'standard' }, session);

    expect(jsonBodyOf(calls[0])).toEqual({
      name: 'New brand',
      description: 'A brand',
      product_type: 'standard',
    });
    expect(text).toContain('product_id: 150');
  });

  it('update_product PATCHes the given fields', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('PATCH', '/api/v2/products/147'),
        body: { data: { ...PRODUCT, is_archived: true } },
      },
    ]);

    await (
      await findTool('update_product')
    ).handler({ product_id: 147, is_archived: true }, session);

    expect(calls[0]!.init?.method).toBe('PATCH');
    expect(jsonBodyOf(calls[0])).toEqual({ is_archived: true });
  });

  it('set_active_organization switches scope and list_organizations marks it', async () => {
    const { session } = buildSession([]);

    const switched = await (
      await findTool('set_active_organization')
    ).handler({ organization_id: 8 }, session);
    const listed = await (await findTool('list_organizations')).handler({}, session);

    expect(session.organizationId).toBe(8);
    expect(switched).toContain('Second Org');
    expect(listed).toMatch(/Second Org.*← active/);
  });

  it('set_active_organization fails for an organization the user is not a member of', async () => {
    const { session } = buildSession([]);

    const result = await callTool('set_active_organization', { organization_id: 999 }, session);

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(
      'Error: You are not a member of organization 999. Call list_organizations to see your organizations.'
    );
    expect(session.organizationId).toBe(7);
  });

  it('every gateway call carries the active organization as X-Organization-Id', async () => {
    const products = {
      match: pathMatcher('GET', '/api/v2/products'),
      body: { data: [PRODUCT], total: 1 },
    };
    const { session, calls } = buildSession([products, products]);

    await (await findTool('list_products')).handler({}, session);
    await (await findTool('set_active_organization')).handler({ organization_id: 8 }, session);
    await (await findTool('list_products')).handler({}, session);

    const headerOf = (call: { init?: RequestInit } | undefined) =>
      (call?.init?.headers as Record<string, string>)['X-Organization-Id'];
    expect(headerOf(calls[0])).toBe('7');
    expect(headerOf(calls[1])).toBe('8');
  });
});

describe('audiences', () => {
  it('list_audiences unwraps {audiences} for the active product', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('GET', '/api/v2/audiences'),
        body: {
          audiences: [
            {
              id: '9',
              name: 'Founders',
              short_id: 'f1',
              description: 'Early-stage founders',
              has_persona: true,
            },
          ],
        },
      },
    ]);
    await session.setActiveProduct(147, 'Visibilio');

    const text = await (await findTool('list_audiences')).handler({}, session);

    expect(Object.fromEntries(new URL(calls[0]!.url).searchParams)).toEqual({ product_id: '147' });
    expect(text).toContain('Founders');
    expect(text).toContain('audience_id: 9');
    expect(text).toContain('Early-stage founders');
  });

  it('create_audience posts name, description and the product', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('POST', '/api/v2/audiences'),
        status: 201,
        body: { audience: { id: '10', name: 'CTOs', description: 'Technical buyers' } },
      },
    ]);
    await session.setActiveProduct(147, 'Visibilio');

    const text = await (
      await findTool('create_audience')
    ).handler({ name: 'CTOs', description: 'Technical buyers' }, session);

    expect(jsonBodyOf(calls[0])).toEqual({
      name: 'CTOs',
      description: 'Technical buyers',
      product_id: 147,
    });
    expect(text).toContain('audience_id: 10');
  });

  it('delete_audience issues DELETE', async () => {
    const { session, calls } = buildSession([
      { match: pathMatcher('DELETE', '/api/v2/audiences/10'), status: 204, body: undefined },
    ]);

    const text = await (await findTool('delete_audience')).handler({ audience_id: 10 }, session);

    expect(calls[0]!.init?.method).toBe('DELETE');
    expect(text).toMatch(/deleted/i);
  });
});
