import { describe, it, expect } from 'vitest';
import { buildSession, findTool, jsonBodyOf, pathMatcher } from './_helpers.js';

const ITEM = {
  id: 501,
  product_id: 147,
  type: 'article',
  title: 'Why MCP matters',
  subtitle: null,
  body: '<p>Body text</p>',
  status: 'draft',
  platform: 'blog',
  language: 'en',
  tags: ['mcp'],
  categories: [],
  seo_meta: { description: 'desc' },
  canonical_url: null,
  updated_at: '2026-10-13T10:00:00Z',
  created_at: '2026-10-12T10:00:00Z',
  audiences: [{ id: '9', name: 'Founders' }],
};

describe('content items — listing and reading', () => {
  it('list_content_items reads the active product and forwards filters as query params', async () => {
    const { session, calls } = buildSession([
      { match: pathMatcher('GET', '/api/v2/products/147/content-items'), body: { data: [ITEM] } },
    ]);
    session.setActiveProduct(147, 'Visibilio');

    const text = await (
      await findTool('list_content_items')
    ).handler({ status: 'draft', type: 'article', search: 'MCP', limit: 20 }, session);

    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe('/api/v2/products/147/content-items');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      status: 'draft',
      type: 'article',
      search: 'MCP',
      limit: '20',
    });
    expect(text).toContain('Why MCP matters');
    expect(text).toContain('content_item_id: 501');
    expect(text).toContain('draft');
  });

  it('list_content_items honours an explicit product_id over the active product', async () => {
    const { session, calls } = buildSession([
      { match: pathMatcher('GET', '/api/v2/products/9/content-items'), body: { data: [] } },
    ]);
    session.setActiveProduct(147, 'Visibilio');

    const text = await (await findTool('list_content_items')).handler({ product_id: 9 }, session);

    expect(calls[0]!.url).toContain('/api/v2/products/9/content-items');
    expect(text).toMatch(/No content items/);
  });

  it('list_content_items without any product explains how to pick one', async () => {
    const { session, calls } = buildSession([]);

    const text = await (await findTool('list_content_items')).handler({}, session);

    expect(text).toMatch(/No active product/);
    expect(text).toContain('set_active_product');
    expect(calls).toHaveLength(0);
  });

  it('get_content_item returns the item fields including the body', async () => {
    const { session } = buildSession([
      { match: pathMatcher('GET', '/api/v2/content-items/501'), body: { data: ITEM } },
    ]);

    const text = await (
      await findTool('get_content_item')
    ).handler({ content_item_id: 501 }, session);

    expect(text).toContain('Why MCP matters');
    expect(text).toContain('<p>Body text</p>');
    expect(text).toContain('Founders');
  });

  it('a gateway 404 is reported to the model as an error message, not thrown', async () => {
    const { session } = buildSession([
      {
        match: pathMatcher('GET', '/api/v2/content-items/999'),
        status: 404,
        body: { error: 'NOT_FOUND', message: 'Content item not found' },
      },
    ]);

    const text = await (
      await findTool('get_content_item')
    ).handler({ content_item_id: 999 }, session);

    expect(text).toMatch(/HTTP 404/);
    expect(text).toContain('Content item not found');
  });
});

describe('content items — writing', () => {
  it('create_content_item posts to the product-scoped route with the editorial fields', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('GET', '/api/v2/workflow/exec-1/status'),
        body: { execution_id: 'exec-1', state: 'completed', final_output: { steps: {} } },
      },
      {
        match: pathMatcher('POST', '/api/v2/products/147/content-items'),
        status: 201,
        body: { data: { ...ITEM, id: 777 } },
      },
    ]);
    session.setActiveProduct(147, 'Visibilio');

    const text = await (
      await findTool('create_content_item')
    ).handler(
      {
        type: 'article',
        title: 'Why MCP matters',
        body: '<p>Body text</p>',
        platform: 'blog',
        language: 'en',
        tags: ['mcp'],
        audience_ids: ['9'],
        source_execution_id: 'exec-1',
      },
      session
    );

    expect(jsonBodyOf(calls[1])).toEqual({
      type: 'article',
      title: 'Why MCP matters',
      body: '<p>Body text</p>',
      platform: 'blog',
      language: 'en',
      tags: ['mcp'],
      audience_ids: ['9'],
      source_execution_id: 'exec-1',
    });
    expect(text).toContain('content_item_id: 777');
  });

  const AEO_ASSETS = {
    faqs: [{ question: 'What does it cost?', answer: 'From 29 990 EUR.' }],
    summary_bullets: ['Plug-in hybrid', '83 km electric range'],
    sources: [{ url: 'https://example.com/a', title: 'Review', publisher: 'example.com' }],
  };

  const completedRun = (pieces: Array<Record<string, unknown>>) => ({
    execution_id: '544',
    state: 'completed',
    is_complete: true,
    final_output: {
      steps: { content_1: { output: { content_pieces: pieces } } },
      steps_completed: 1,
    },
  });

  it('create_content_item saving a workflow run keeps the FAQ, summary bullets and sources it generated', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('GET', '/api/v2/workflow/544/status'),
        body: completedRun([
          { title: 'Geely Starray EM-i', body: '<p>Body</p>', aeo_assets: AEO_ASSETS },
        ]),
      },
      {
        match: pathMatcher('POST', '/api/v2/products/147/content-items'),
        status: 201,
        body: { data: { ...ITEM, id: 778 } },
      },
    ]);
    session.setActiveProduct(147, 'Visibilio');

    await (
      await findTool('create_content_item')
    ).handler(
      {
        type: 'article',
        title: 'Geely Starray EM-i: what 29 990 EUR buys',
        body: '<p>Body</p>',
        source_execution_id: '544',
      },
      session
    );

    expect(jsonBodyOf(calls[1])).toMatchObject({
      source_execution_id: '544',
      aeo_assets: AEO_ASSETS,
    });
  });

  it('create_content_item takes the assets of the piece it saves when the run produced several', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('GET', '/api/v2/workflow/544/status'),
        body: completedRun([
          { title: 'LinkedIn teaser', body: 'Short post', aeo_assets: null },
          { title: 'Geely Starray EM-i', body: '<p>Body</p>', aeo_assets: AEO_ASSETS },
        ]),
      },
      {
        match: pathMatcher('POST', '/api/v2/products/147/content-items'),
        status: 201,
        body: { data: { ...ITEM, id: 779 } },
      },
    ]);
    session.setActiveProduct(147, 'Visibilio');

    await (
      await findTool('create_content_item')
    ).handler(
      {
        type: 'article',
        title: 'Geely Starray EM-i',
        body: '<p>Body</p>',
        source_execution_id: '544',
      },
      session
    );

    expect(jsonBodyOf(calls[1])).toMatchObject({ aeo_assets: AEO_ASSETS });
  });

  it('update_content_item PUTs only the provided fields and marks the edit as agent-made', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('PUT', '/api/v2/content-items/501'),
        body: { data: { ...ITEM, status: 'review' }, changed_fields: ['status'] },
      },
    ]);

    const text = await (
      await findTool('update_content_item')
    ).handler({ content_item_id: 501, status: 'review', edit_prompt: 'ready for review' }, session);

    expect(jsonBodyOf(calls[0])).toEqual({
      status: 'review',
      edit_prompt: 'ready for review',
      created_by: 'agent',
    });
    expect(text).toContain('status');
    expect(text).toContain('review');
  });

  it('delete_content_item issues DELETE and reports a published-elsewhere conflict verbatim', async () => {
    const { session } = buildSession([
      {
        match: pathMatcher('DELETE', '/api/v2/content-items/501'),
        status: 409,
        body: {
          error: 'CONTENT_ITEM_PUBLISHED',
          message: 'Unpublish first',
          details: { destinations: ['hub 3'] },
        },
      },
    ]);

    const text = await (
      await findTool('delete_content_item')
    ).handler({ content_item_id: 501 }, session);

    expect(text).toMatch(/HTTP 409/);
    expect(text).toContain('Unpublish first');
  });

  it('restore_content_item_version posts the version id', async () => {
    const { session, calls } = buildSession([
      { match: pathMatcher('POST', '/api/v2/content-items/501/restore'), body: { data: ITEM } },
    ]);

    await (
      await findTool('restore_content_item_version')
    ).handler({ content_item_id: 501, version_id: 42 }, session);

    expect(jsonBodyOf(calls[0])).toEqual({ version_id: 42 });
  });
});

describe('content items — AI helpers', () => {
  it('generate_seo_meta fetches the item body when none is supplied and does not persist', async () => {
    const { session, calls } = buildSession([
      { match: pathMatcher('GET', '/api/v2/content-items/501'), body: { data: ITEM } },
      {
        match: pathMatcher('POST', '/api/v2/content-items/501/seo-meta'),
        body: {
          data: {
            seo_meta: {
              description: 'A crisp description',
              keywords: ['mcp'],
              suggested_slug: 'why-mcp',
            },
          },
        },
      },
    ]);

    const text = await (
      await findTool('generate_seo_meta')
    ).handler({ content_item_id: 501 }, session);

    expect(jsonBodyOf(calls[1])).toMatchObject({
      body: '<p>Body text</p>',
      title: 'Why MCP matters',
    });
    expect(text).toContain('A crisp description');
    expect(text).toContain('update_content_item');
  });

  it('repurpose_content_item forwards targets and context', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('POST', '/api/v2/content-items/501/repurpose'),
        status: 201,
        body: {
          data: {
            session_id: 's1',
            source_content_item_id: 501,
            variants: [{ id: 601, title: 'LinkedIn take', platform: 'linkedin' }],
            variants_count: 1,
          },
        },
      },
    ]);

    const text = await (
      await findTool('repurpose_content_item')
    ).handler(
      {
        content_item_id: 501,
        targets: [{ platform: 'linkedin', content_type: 'social_post', remix_strategy: 'adapt' }],
        additional_context: 'keep it short',
      },
      session
    );

    expect(jsonBodyOf(calls[0])).toEqual({
      targets: [{ platform: 'linkedin', content_type: 'social_post', remix_strategy: 'adapt' }],
      additional_context: 'keep it short',
    });
    expect(text).toContain('content_item_id: 601');
    expect(text).toContain('linkedin');
  });

  it('translate_content_item sends the target language', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('POST', '/api/v2/content-items/501/translate'),
        status: 201,
        body: { data: { ...ITEM, id: 611, language: 'bg' } },
      },
    ]);

    const text = await (
      await findTool('translate_content_item')
    ).handler({ content_item_id: 501, target_language: 'bg' }, session);

    expect(jsonBodyOf(calls[0])).toEqual({ target_language: 'bg' });
    expect(text).toContain('content_item_id: 611');
  });
});
