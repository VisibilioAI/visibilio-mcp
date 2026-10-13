import { describe, it, expect } from 'vitest';
import { buildSession, findTool, pathMatcher } from './_helpers.js';

describe('measurement', () => {
  it('get_measurement_overview passes productId and the window and renders headline totals', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('GET', '/api/v2/measurement/overview'),
        body: {
          data: {
            product_id: 147,
            period: { from: '2026-10-06', to: '2026-10-12' },
            published: { count: 4 },
            impressions_total: 1200,
            engagement_total: 80,
            website_sessions: { total: 530 },
            empty_state: null,
          },
        },
      },
    ]);
    session.setActiveProduct(147, 'Visibilio');

    const text = await (await findTool('get_measurement_overview')).handler({ from: '2026-10-06', to: '2026-10-12' }, session);

    expect(Object.fromEntries(new URL(calls[0]!.url).searchParams)).toEqual({ productId: '147', from: '2026-10-06', to: '2026-10-12' });
    expect(text).toContain('1200');
    expect(text).toContain('2026-10-06');
  });

  it('a feature-flag 404 is explained instead of surfacing as a bare error', async () => {
    const { session } = buildSession([
      { match: pathMatcher('GET', '/api/v2/measurement/overview'), status: 404, body: { error: 'Not Found' } },
    ]);
    session.setActiveProduct(147, 'Visibilio');

    const text = await (await findTool('get_measurement_overview')).handler({}, session);

    expect(text).toMatch(/not enabled/i);
  });

  it('list_measurement_recommendations forwards state and product', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('GET', '/api/v2/measurement/recommendations'),
        body: { data: [{ id: 4, rule_id: 'refresh_top_page', reason: 'Traffic dropped 30%', state: 'open', recommended_topic: 'Refresh the pricing page' }] },
      },
    ]);
    session.setActiveProduct(147, 'Visibilio');

    const text = await (await findTool('list_measurement_recommendations')).handler({ state: 'open' }, session);

    expect(Object.fromEntries(new URL(calls[0]!.url).searchParams)).toEqual({ productId: '147', state: 'open' });
    expect(text).toContain('Refresh the pricing page');
    expect(text).toContain('recommendation_id: 4');
  });
});

describe('AI visibility (answer engine)', () => {
  it('get_ai_visibility_metrics reads the product metrics with optional scope filters', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('GET', '/api/v2/answer-engine/products/147/metrics'),
        body: { data: { cycle: { id: 3, number: 3 }, metrics: { mentionRate: 0.42, occurrenceShareOfVoice: 0.2, answerCountedShareOfVoice: 0.25, coverage: 0.9 }, measurements: [], analysis: null } },
      },
    ]);
    session.setActiveProduct(147, 'Visibilio');

    const text = await (await findTool('get_ai_visibility_metrics')).handler({ provider: 'openai', question_class: 'unbranded' }, session);

    expect(Object.fromEntries(new URL(calls[0]!.url).searchParams)).toEqual({ provider: 'openai', questionClass: 'unbranded' });
    expect(text).toContain('42');
    expect(text).toContain('mention rate');
  });

  it('list_ai_visibility_recommendations lists active recommendations with their gap', async () => {
    const { session } = buildSession([
      {
        match: pathMatcher('GET', '/api/v2/answer-engine/products/147/recommendations'),
        body: { data: { recommendations: [{ id: 'r1', topicName: 'Pricing', rule: 'competitor_cited', subject: 'acme.test/pricing', gapMetricValue: 0.3, status: 'active' }], emptyStateReason: null } },
      },
    ]);
    session.setActiveProduct(147, 'Visibilio');

    const text = await (await findTool('list_ai_visibility_recommendations')).handler({}, session);

    expect(text).toContain('Pricing');
    expect(text).toContain('recommendation_id: r1');
  });

  it('list_ai_visibility_answers forwards paging and mention filters', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('GET', '/api/v2/answer-engine/products/147/answers'),
        body: { data: { scope: {}, totals: { included: 10, mentioned: 4 }, page: 1, pageSize: 20, total: 10, items: [{ question: 'Best MCP server?', provider: 'openai', mentioned: true }] } },
      },
    ]);
    session.setActiveProduct(147, 'Visibilio');

    const text = await (await findTool('list_ai_visibility_answers')).handler({ mention: 'mentioned', page: 1 }, session);

    expect(Object.fromEntries(new URL(calls[0]!.url).searchParams)).toEqual({ mention: 'mentioned', page: '1' });
    expect(text).toContain('Best MCP server?');
  });
});
