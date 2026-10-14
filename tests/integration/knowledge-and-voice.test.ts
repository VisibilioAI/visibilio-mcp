import { describe, it, expect } from 'vitest';
import { buildSession, findTool, jsonBodyOf, pathMatcher } from './_helpers.js';

describe('knowledge', () => {
  it('get_knowledge reads the product-scoped domain when a product is active', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('GET', '/api/v2/products/147/knowledge/content_strategy'),
        body: {
          data: {
            organization_id: 7,
            product_id: 147,
            domain: 'content_strategy',
            content: { pillars: ['education'] },
            version: { version_number: 4 },
          },
        },
      },
    ]);
    await session.setActiveProduct(147, 'Visibilio');

    const text = await (
      await findTool('get_knowledge')
    ).handler({ domain: 'content_strategy' }, session);

    expect(calls[0]!.url).toContain('/api/v2/products/147/knowledge/content_strategy');
    expect(text).toContain('education');
    expect(text).toContain('version 4');
  });

  it('get_knowledge falls back to the organization-level domain when no product is active', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('GET', '/api/v2/knowledge/company_profile'),
        body: {
          data: {
            organization_id: 7,
            domain: 'company_profile',
            content: { name: 'Acme' },
            version: null,
          },
        },
      },
    ]);

    const text = await (
      await findTool('get_knowledge')
    ).handler({ domain: 'company_profile' }, session);

    expect(calls[0]!.url).toContain('/api/v2/knowledge/company_profile');
    expect(text).toContain('Acme');
  });

  it('get_knowledge rejects an unknown domain before calling the gateway', async () => {
    const { session, calls } = buildSession([]);

    const text = await (await findTool('get_knowledge')).handler({ domain: 'secrets' }, session);

    expect(text).toMatch(/Invalid domain/);
    expect(calls).toHaveLength(0);
  });

  it('update_knowledge PUTs the full content with a change note', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('PUT', '/api/v2/products/147/knowledge/company_profile'),
        body: {
          data: {
            domain: 'company_profile',
            content: { name: 'Acme', industry: 'SaaS' },
            version: { version_number: 2 },
          },
        },
      },
    ]);
    await session.setActiveProduct(147, 'Visibilio');

    const text = await (
      await findTool('update_knowledge')
    ).handler(
      {
        domain: 'company_profile',
        content: { name: 'Acme', industry: 'SaaS' },
        change_note: 'added industry',
      },
      session
    );

    expect(jsonBodyOf(calls[0])).toEqual({
      content: { name: 'Acme', industry: 'SaaS' },
      change_note: 'added industry',
    });
    expect(text).toContain('version 2');
  });

  it('search_knowledge posts the query and renders results with their domain and score', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('POST', '/api/v2/knowledge/search'),
        body: {
          query: 'pricing',
          results: [
            { domain: 'company_profile', content: { pricing: 'freemium' }, relevance_score: 0.91 },
          ],
        },
      },
    ]);

    const text = await (
      await findTool('search_knowledge')
    ).handler({ query: 'pricing', domains: ['company_profile'] }, session);

    expect(jsonBodyOf(calls[0])).toEqual({ query: 'pricing', domains: ['company_profile'] });
    expect(text).toContain('company_profile');
    expect(text).toContain('freemium');
    expect(text).toContain('0.91');
  });

  it('accept_knowledge_proposal posts to the accept route', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('POST', '/api/v2/knowledge/proposals/8/accept'),
        body: {
          data: {
            proposal_id: 8,
            status: 'accepted',
            domain: 'market_intelligence',
            version: { version_number: 3 },
          },
        },
      },
    ]);

    const text = await (
      await findTool('accept_knowledge_proposal')
    ).handler({ proposal_id: 8 }, session);

    expect(calls[0]!.url).toContain('/api/v2/knowledge/proposals/8/accept');
    expect(text).toContain('accepted');
  });
});

describe('brand voice', () => {
  const DOCUMENT = {
    schema_version: 1,
    voice_statement: 'Clear, warm, direct.',
    tone: { formality: 'neutral', warmth: 4, confidence: 4, humor: 'subtle', energy: 'measured' },
    do_list: ['be concrete'],
    dont_list: ['no hype'],
  };

  it('get_brand_voice returns the structured document', async () => {
    const { session } = buildSession([
      {
        match: pathMatcher('GET', '/api/v2/brand-voice/147'),
        body: { document: DOCUMENT, legacy_text: null, has_structured: true },
      },
    ]);
    await session.setActiveProduct(147, 'Visibilio');

    const text = await (await findTool('get_brand_voice')).handler({}, session);

    expect(text).toContain('Clear, warm, direct.');
    expect(text).toContain('be concrete');
  });

  it('update_brand_voice reads the current content_strategy version when none is given, then PUTs', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('GET', '/api/v2/products/147/knowledge/content_strategy'),
        body: { data: { domain: 'content_strategy', content: {}, version: { version_number: 6 } } },
      },
      {
        match: pathMatcher('PUT', '/api/v2/brand-voice/147'),
        body: { document: DOCUMENT, has_structured: true, version: { version_number: 7 } },
      },
    ]);
    await session.setActiveProduct(147, 'Visibilio');

    const text = await (
      await findTool('update_brand_voice')
    ).handler({ document: DOCUMENT }, session);

    expect(jsonBodyOf(calls[1])).toEqual({ document: DOCUMENT, version_number: 6 });
    expect(text).toContain('version 7');
  });

  it('analyze_brand_voice_text starts an analysis and get_brand_voice_analysis polls it', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('POST', '/api/v2/brand-voice/147/analyze-text'),
        status: 202,
        body: { execution_id: 'bv-1', status: 'running' },
      },
      {
        match: pathMatcher('GET', '/api/v2/brand-voice/147/generate/bv-1'),
        body: {
          execution_id: 'bv-1',
          status: 'completed',
          progress_percentage: 100,
          brand_voice: DOCUMENT,
          error: null,
        },
      },
    ]);
    await session.setActiveProduct(147, 'Visibilio');

    const started = await (
      await findTool('analyze_brand_voice_text')
    ).handler({ text: 'x'.repeat(120), mode: 'merge' }, session);
    const polled = await (
      await findTool('get_brand_voice_analysis')
    ).handler({ execution_id: 'bv-1' }, session);

    expect(jsonBodyOf(calls[0])).toEqual({ text: 'x'.repeat(120), mode: 'merge' });
    expect(started).toContain('bv-1');
    expect(polled).toContain('completed');
    expect(polled).toContain('Clear, warm, direct.');
    expect(polled).toContain('update_brand_voice');
  });
});
