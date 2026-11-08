import { describe, it, expect } from 'vitest';
import { buildSession, callTool, findTool, jsonBodyOf, pathMatcher, textOf } from './_helpers.js';

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
    await session.setActiveProduct(147, 'Visibilio');

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
    await session.setActiveProduct(147, 'Visibilio');

    const text = await (await findTool('list_content_items')).handler({ product_id: 9 }, session);

    expect(calls[0]!.url).toContain('/api/v2/products/9/content-items');
    expect(text).toMatch(/No content items/);
  });

  it('list_content_items without any product fails and explains how to pick one', async () => {
    const { session, calls } = buildSession([]);

    const result = await callTool('list_content_items', {}, session);

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(
      'Error: No active product. Call list_products, then set_active_product (or pass product_id).'
    );
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

  it('get_content_item surfaces the item author_name so clients can read it', async () => {
    const { session } = buildSession([
      {
        match: pathMatcher('GET', '/api/v2/content-items/501'),
        body: { data: { ...ITEM, author_name: 'Neli Kostova' } },
      },
    ]);

    const text = await (
      await findTool('get_content_item')
    ).handler({ content_item_id: 501 }, session);

    expect(text).toContain('author_name: Neli Kostova');
  });

  it('a gateway 404 is reported to the model as a failed result with the gateway message, not thrown', async () => {
    const { session } = buildSession([
      {
        match: pathMatcher('GET', '/api/v2/content-items/999'),
        status: 404,
        body: { error: 'NOT_FOUND', message: 'Content item not found' },
      },
    ]);

    const result = await callTool('get_content_item', { content_item_id: 999 }, session);

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('Get content item failed (HTTP 404): Content item not found');
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
    await session.setActiveProduct(147, 'Visibilio');

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
        audience_ids: [9],
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
      audience_ids: [9],
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
    await session.setActiveProduct(147, 'Visibilio');

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
    await session.setActiveProduct(147, 'Visibilio');

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
      { match: pathMatcher('GET', '/api/v2/content-items/501'), body: { data: ITEM } },
      {
        // The gateway does NOT version a status change, so changed_fields comes
        // back empty even though the status really moved draft -> review. The
        // tool must still report the status change, not "nothing" (#965.7).
        match: pathMatcher('PUT', '/api/v2/content-items/501'),
        body: { data: { ...ITEM, status: 'review' }, changed_fields: [] },
      },
    ]);

    const text = await (
      await findTool('update_content_item')
    ).handler({ content_item_id: 501, status: 'review', edit_prompt: 'ready for review' }, session);

    const putCall = calls.find((c) => (c.init?.method ?? 'GET') === 'PUT');
    expect(jsonBodyOf(putCall)).toEqual({
      status: 'review',
      edit_prompt: 'ready for review',
      created_by: 'agent',
    });
    expect(text).toContain('status');
    expect(text).not.toContain('nothing');
  });

  it('update_content_item reports nothing when the requested value matches the stored one', async () => {
    const { session } = buildSession([
      { match: pathMatcher('GET', '/api/v2/content-items/501'), body: { data: ITEM } },
      {
        match: pathMatcher('PUT', '/api/v2/content-items/501'),
        body: { data: ITEM, changed_fields: [] },
      },
    ]);

    const text = await (
      await findTool('update_content_item')
    ).handler({ content_item_id: 501, status: 'draft' }, session);

    expect(text).toContain('nothing');
    expect(text).not.toContain('Updated: status');
  });

  it('update_content_item prints the gateway updated_fields verbatim when the response supplies them', async () => {
    // The gateway is authoritative about what changed, including non-versioned keys
    // the client did not single out (platform here is unchanged and unrequested, so
    // client-side reconciliation could never derive it). The tool reports its list.
    const { session } = buildSession([
      { match: pathMatcher('GET', '/api/v2/content-items/501'), body: { data: ITEM } },
      {
        match: pathMatcher('PUT', '/api/v2/content-items/501'),
        body: {
          data: { ...ITEM, status: 'review' },
          changed_fields: [],
          updated_fields: ['status', 'platform'],
        },
      },
    ]);

    const text = await (
      await findTool('update_content_item')
    ).handler({ content_item_id: 501, status: 'review' }, session);

    expect(text).toContain('Updated: status, platform');
  });

  it('delete_content_item issues DELETE and reports a published-elsewhere conflict verbatim as a failed result', async () => {
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

    const result = await callTool('delete_content_item', { content_item_id: 501 }, session);

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('Delete content item failed (HTTP 409): Unpublish first');
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

  it('duplicate_content_item clones the item and reports the new draft id', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('POST', '/api/v2/content-items/501/duplicate'),
        status: 201,
        body: {
          data: {
            id: 777,
            title: 'Why MCP matters (Copy)',
            type: 'article',
            status: 'draft',
            platform: 'blog',
            language: 'en',
            updated_at: '2026-10-14T10:00:00Z',
          },
        },
      },
    ]);

    const text = await (
      await findTool('duplicate_content_item')
    ).handler({ content_item_id: 501 }, session);

    expect(calls[0]!.url).toContain('/api/v2/content-items/501/duplicate');
    expect(text).toContain('Duplicated.');
    expect(text).toContain('Why MCP matters (Copy)');
    expect(text).toContain('content_item_id: 777');
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

  it('repurpose_content_item forwards targets and context to the async route', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('POST', '/api/v2/content-items/501/repurpose-async'),
        status: 202,
        body: { job_id: 777, status: 'running' },
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
    expect(text).toContain('777');
    expect(text).toContain('get_generation_job_status');
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

  it('quick_repurpose_content_item forwards context and lists the created draft ids', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('POST', '/api/v2/content-items/501/quick-repurpose'),
        body: { data: { created_content_item_ids: [811, 812] } },
      },
    ]);

    const text = await (
      await findTool('quick_repurpose_content_item')
    ).handler(
      { content_item_id: 501, additional_context: 'make it punchy', language: 'en' },
      session
    );

    expect(jsonBodyOf(calls[0])).toEqual({ additional_context: 'make it punchy', language: 'en' });
    expect(text).toContain('Created 2 draft(s):');
    expect(text).toContain('content_item_id: 811');
    expect(text).toContain('content_item_id: 812');
  });

  it('validate_brand_voice scores the supplied content and returns the verdict', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('POST', '/api/v2/content-items/501/voice-validate'),
        body: { data: { on_brand: true, tone_alignment: 0.9, issues: [] } },
      },
    ]);

    const text = await (
      await findTool('validate_brand_voice')
    ).handler({ content_item_id: 501, content: 'Sample copy to score' }, session);

    expect(jsonBodyOf(calls[0])).toEqual({ content: 'Sample copy to score' });
    expect(text).toContain('"on_brand": true');
  });
});

describe('content items — publication drift (get_content_item)', () => {
  const PUBLISHED = { ...ITEM, id: 777, status: 'published', version: 5 };
  const ACTIVE_HUB = { id: 'hub-1', name: 'Blog', is_active: true };

  it('warns that a published item whose live page is behind has changes not live', async () => {
    const { session } = buildSession([
      { match: pathMatcher('GET', '/api/v2/content-items/777'), body: { data: PUBLISHED } },
      { match: pathMatcher('GET', '/api/v2/content-hubs'), body: { data: [ACTIVE_HUB] } },
      {
        match: pathMatcher('GET', '/api/v2/content-hubs/hub-1/publications'),
        body: { data: [{ content_item_id: 777, published_version: 3, live_url: null }] },
      },
    ]);

    const text = await (
      await findTool('get_content_item')
    ).handler({ content_item_id: 777 }, session);

    expect(text).toContain('changes not live');
  });

  it('adds no drift claim when the live page matches the current version', async () => {
    const { session } = buildSession([
      { match: pathMatcher('GET', '/api/v2/content-items/777'), body: { data: PUBLISHED } },
      { match: pathMatcher('GET', '/api/v2/content-hubs'), body: { data: [ACTIVE_HUB] } },
      {
        match: pathMatcher('GET', '/api/v2/content-hubs/hub-1/publications'),
        body: { data: [{ content_item_id: 777, published_version: 5, live_url: null }] },
      },
    ]);

    const text = await (
      await findTool('get_content_item')
    ).handler({ content_item_id: 777 }, session);

    expect(text).not.toContain('changes not live');
  });

  it('does not query hubs for a non-published item and adds no drift claim', async () => {
    const { session, calls } = buildSession([
      { match: pathMatcher('GET', '/api/v2/content-items/501'), body: { data: ITEM } },
    ]);

    const text = await (
      await findTool('get_content_item')
    ).handler({ content_item_id: 501 }, session);

    expect(calls).toHaveLength(1);
    expect(text).not.toContain('changes not live');
  });
});

describe('content items — signal linkage', () => {
  it('create_content_item threads signal_id into the create body so the gateway marks the signal used', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('POST', '/api/v2/products/147/content-items'),
        status: 201,
        body: { data: { ...ITEM, id: 779 } },
      },
    ]);
    await session.setActiveProduct(147, 'Visibilio');

    await (
      await findTool('create_content_item')
    ).handler(
      { type: 'social_post', title: 'From a signal', body: 'Post text', signal_id: 42 },
      session
    );

    expect(jsonBodyOf(calls[0])).toMatchObject({ signal_id: 42 });
  });

  // Regression guard - passes at authorship; locks in that a save unrelated to a signal carries no
  // signal_id, so the gateway marks nothing.
  it('create_content_item sends no signal_id when none is given', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('POST', '/api/v2/products/147/content-items'),
        status: 201,
        body: { data: { ...ITEM, id: 780 } },
      },
    ]);
    await session.setActiveProduct(147, 'Visibilio');

    await (
      await findTool('create_content_item')
    ).handler({ type: 'social_post', title: 'Hand-written', body: 'Post text' }, session);

    expect(jsonBodyOf(calls[0])).not.toHaveProperty('signal_id');
  });
});

describe('content items — version history formatting', () => {
  const versionsPath = '/api/v2/content-items/501/versions';

  it('renders an edit note of up to 160 characters in full, without an ellipsis', async () => {
    const note =
      'Clarified the pricing section and aligned the closing call-to-action with the latest brand voice guidance ahead of the Q4 product launch.';
    expect(note.length).toBeGreaterThan(80);
    expect(note.length).toBeLessThanOrEqual(160);

    const { session } = buildSession([
      {
        match: pathMatcher('GET', versionsPath),
        body: {
          data: [
            {
              id: 42,
              title: 'Why MCP matters',
              created_at: '2026-10-13T10:00:00Z',
              created_by: 'agent',
              changed_fields: ['body'],
              edit_prompt: note,
            },
          ],
        },
      },
    ]);

    const text = await (
      await findTool('list_content_item_versions')
    ).handler({ content_item_id: 501 }, session);

    expect(text).toContain(note);
    expect(text).not.toContain('…');
  });

  // Regression guard - passes at authorship; locks in the 160-char output-size budget so a note
  // longer than the cap is still shortened rather than dumped in full across up to 200 rows.
  it('still truncates an edit note longer than 160 characters', async () => {
    const longNote = 'A'.repeat(200);

    const { session } = buildSession([
      {
        match: pathMatcher('GET', versionsPath),
        body: {
          data: [
            {
              id: 43,
              title: 'Why MCP matters',
              created_at: '2026-10-13T10:00:00Z',
              created_by: 'agent',
              changed_fields: ['body'],
              edit_prompt: longNote,
            },
          ],
        },
      },
    ]);

    const text = await (
      await findTool('list_content_item_versions')
    ).handler({ content_item_id: 501 }, session);

    expect(text).toContain('…');
    expect(text).not.toContain(longNote);
  });

  it('marks a truncated edit note with its full length so the cut is not silent', async () => {
    const longNote = 'A'.repeat(200);

    const { session } = buildSession([
      {
        match: pathMatcher('GET', versionsPath),
        body: {
          data: [
            {
              id: 44,
              title: 'Why MCP matters',
              created_at: '2026-10-13T10:00:00Z',
              created_by: 'agent',
              changed_fields: ['body'],
              edit_prompt: longNote,
            },
          ],
        },
      },
    ]);

    const text = await (
      await findTool('list_content_item_versions')
    ).handler({ content_item_id: 501 }, session);

    expect(text).toContain('(200 chars)');
  });
});
