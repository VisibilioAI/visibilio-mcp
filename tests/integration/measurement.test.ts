import { describe, it, expect } from 'vitest';
import { buildSession, callTool, findTool, pathMatcher, textOf } from './_helpers.js';

type Json = Record<string, unknown>;

function countDelta(current: number, prior: number): Json {
  return {
    current,
    prior,
    delta: current - prior,
    prior_has_data: true,
    comparability: { comparable: true },
  };
}

function block(value: unknown): Json {
  return { value_state: 'measured', value };
}

function scopedBlock(value: unknown, scope = 'visibilio_content'): Json {
  return { value_state: 'measured', value, scope };
}

function topEntry(i: number): Json {
  return {
    entity_ref: `pub:${i}`,
    channel: 'linkedin',
    engagement: i,
    engagement_state: 'measured',
    title: `Publication number ${i} with a representative headline`,
    live_url: `https://example.test/articles/${i}`,
    published_at: '2026-10-10T00:00:00Z',
    content_item_id: 1000 + i,
    impressions: i * 10,
  };
}

function series(metric: string, source: string): Json {
  return {
    metric,
    label: metric,
    source,
    unit: 'count',
    scope: 'visibilio_content',
    value_state: 'measured',
    points: Array.from({ length: 7 }, (_, d) => ({
      date: `2026-10-0${d + 1}`,
      value: d,
      covered_start: `2026-10-0${d + 1}`,
      covered_end: `2026-10-0${d + 1}`,
    })),
    prior_points: [],
    supports_history: true,
    unsupported_reason: null,
    granularity: 'day',
    comparability: { comparable: true },
  };
}

// A faithful fixture of the gateway PerformanceOverview shape
// (visibilio-api-gateway-v2/lib/measurement/overview.ts lines 507-559).
function makeOverview(overrides: Json = {}): Json {
  const measured = Array.from({ length: 25 }, (_, i) => topEntry(i + 1));
  return {
    product_id: 147,
    period: { from: '2026-10-06', to: '2026-10-12' },
    prior_period: { from: '2026-09-29', to: '2026-10-05' },
    published: countDelta(8, 5),
    active_accessible: countDelta(8, 5),
    channels: block([
      { channel: 'linkedin', impressions: 1000, engagement: 50, engagement_state: 'measured' },
    ]),
    impressions_total: block(countDelta(1200, 900)),
    engagement_total: block(countDelta(80, 60)),
    organic_vs_paid: block({ organic_impressions: 1100, paid_spend_usd: 10 }),
    followers: block(null),
    website_sessions: scopedBlock(countDelta(530, 400), 'site_wide'),
    website_engagement: scopedBlock(
      {
        engaged_sessions: countDelta(300, 200),
        engagement_time_seconds: countDelta(5000, 4000),
        pageviews: countDelta(900, 700),
      },
      'site_wide'
    ),
    key_events: {
      ...scopedBlock(countDelta(12, 9), 'site_wide'),
      reason: null,
      by_name: [{ event_name: 'signup', delta: countDelta(12, 9) }],
    },
    search: scopedBlock(
      {
        gsc: block({ impressions: countDelta(2000, 1500), clicks: countDelta(120, 90) }),
        bing: block({ impressions: countDelta(50, 40), clicks: countDelta(5, 4) }),
      },
      'site_wide'
    ),
    search_position: {
      gsc: block({ current: 12.3, prior: 14.1, prior_has_data: true }),
      bing: block({ current: 20.5, as_of_date: '2026-10-10', supports_history: false }),
    },
    top_publications: measured.slice(0, 5),
    measured_publications: measured,
    top_publications_cap: { applied: 5, drawn_from: 25 },
    measured_pages: {
      website: Array.from({ length: 12 }, (_, i) => ({ page: `/p${i}`, sessions: i })),
      search: Array.from({ length: 8 }, (_, i) => ({ page: `/s${i}`, clicks: i })),
    },
    series: [
      series('impressions', 'gsc'),
      series('clicks', 'gsc'),
      series('reactions', 'linkedin'),
      series('sessions', 'ga4'),
    ],
    times_shown: block({
      parts: [
        {
          channel: 'search',
          source: 'gsc',
          platform: null,
          metric: 'impressions',
          scope: 'site_wide',
          points: [],
          total: countDelta(2000, 1500),
          completed_through: '2026-10-12',
          derived: false,
        },
        {
          channel: 'social',
          source: 'linkedin',
          platform: 'linkedin',
          metric: 'impressions',
          scope: 'connected_accounts',
          points: [],
          total: countDelta(1000, 800),
          completed_through: '2026-10-12',
          derived: false,
        },
      ],
      total: { current: 3000, prior: 2300, prior_has_data: true },
      change: {
        window: null,
        prior_window: null,
        current: 3000,
        prior: 2300,
        comparability: { comparable: true },
      },
    }),
    freshness: { data_as_of: '2026-10-12', value_state: 'measured' },
    resolved_windows: [],
    sources_freshness: [
      {
        connector_type: 'gsc',
        status: 'ok',
        last_success_at: '2026-10-13',
        data_available_through: '2026-10-10',
        latest_delivered_day: '2026-10-10',
        product_id: 147,
      },
      {
        connector_type: 'ga4',
        status: 'ok',
        last_success_at: '2026-10-13',
        data_available_through: '2026-10-12',
        latest_delivered_day: '2026-10-12',
        product_id: 147,
      },
    ],
    definitions: Object.fromEntries(
      [
        'impressions',
        'reach',
        'reactions',
        'comments',
        'shares',
        'saves',
        'followers',
        'sessions',
        'engaged_sessions',
        'engagement_time',
        'pageviews',
      ].map((m) => [
        m,
        {
          label: m,
          description: `A fairly long human-readable definition of ${m} that explains exactly what the metric means, how it is counted and the caveats that apply so a reader does not misinterpret it.`,
        },
      ])
    ),
    empty_state: null,
    search_queries: block({
      site_url: 'https://example.test',
      top_queries: Array.from({ length: 30 }, (_, i) => ({
        query: `query number ${i}`,
        clicks: i,
        impressions: i * 10,
        ctr: 0.1,
        position: i + 1,
        branded: 'unknown',
      })),
      data_through: '2026-10-10',
      window: { start: '2026-10-06', end: '2026-10-12' },
      collection: null,
      branded_classification: { state: 'unknown', reason: 'x' },
    }),
    traffic_sources: {
      ...scopedBlock(
        [
          { source_medium: 'google / organic', sessions: 400, is_ai_assistant: false },
          { source_medium: 'chatgpt.com / referral', sessions: 30, is_ai_assistant: true },
        ],
        'site_wide'
      ),
      data_available_from: '2026-09-01',
    },
    ai_assistant_sessions: scopedBlock(countDelta(30, 20), 'site_wide'),
    ...overrides,
  };
}

function overviewResponse(body: Json = makeOverview()) {
  return { match: pathMatcher('GET', '/api/v2/measurement/overview'), body: { data: body } };
}

async function runOverview(args: Json, body: Json = makeOverview()) {
  const { session, calls } = buildSession([overviewResponse(body)]);
  await session.setActiveProduct(147, 'Visibilio');
  const text = (await (
    await findTool('get_measurement_overview')
  ).handler(args, session)) as string;
  return { text, parsed: JSON.parse(text) as Json, calls };
}

function windowDaysInclusive(from: string, to: string): number {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
}

describe('measurement overview — compact by default (meta#975)', () => {
  it('returns a compact summary by default and omits the heavy blocks', async () => {
    const { parsed, calls } = await runOverview({ from: '2026-10-06', to: '2026-10-12' });

    expect(Object.fromEntries(new URL(calls[0]!.url).searchParams)).toEqual({
      productId: '147',
      from: '2026-10-06',
      to: '2026-10-12',
      view: 'summary',
    });

    expect(parsed.product_id).toBe(147);
    expect(parsed.period).toEqual({ from: '2026-10-06', to: '2026-10-12' });
    expect(parsed.impressions_total).toEqual({ current: 1200, prior: 900, delta: 300 });
    expect(parsed.engagement_total).toEqual({ current: 80, prior: 60, delta: 20 });

    const available = parsed.available as Json;
    expect(available.publications).toBe(25);
    expect(available.series).toBe(4);
    expect(available.definitions).toBe(11);
    expect(available.pages).toEqual({ website: 12, search: 8 });
    expect(available.search_queries).toBe(30);

    // The top-publications head stays (<=5); the full populations do not.
    expect(parsed.top_publications).toHaveLength(5);
    expect(parsed.series).toBeUndefined();
    expect(parsed.definitions).toBeUndefined();
    expect(parsed.measured_publications).toBeUndefined();
    expect(parsed.measured_pages).toBeUndefined();
  });

  it('keeps the compact default well under the 25,000-char read budget', async () => {
    const { text } = await runOverview({});
    expect(text.length).toBeLessThan(25000);
    // Prove it is not a passthrough: the full payload is materially larger.
    expect(text.length).toBeLessThan(JSON.stringify(makeOverview()).length);
  });

  it('defaults to the summary view', async () => {
    const { calls } = await runOverview({});
    expect(new URL(calls[0]!.url).searchParams.get('view')).toBe('summary');
  });

  it('includes the definitions dictionary only when the definitions section is requested', async () => {
    const def = await runOverview({});
    expect(def.parsed.definitions).toBeUndefined();

    const withDef = await runOverview({ sections: ['definitions'] });
    expect(Object.keys(withDef.parsed.definitions as Json)).toContain('impressions');
  });

  it('paginates the publications section and reports totals', async () => {
    const { parsed } = await runOverview({ sections: ['publications'], page: 2, page_size: 10 });
    const pubs = parsed.publications as Json;
    expect(pubs.total).toBe(25);
    expect(pubs.page).toBe(2);
    expect(pubs.page_size).toBe(10);
    expect(pubs.total_pages).toBe(3);
    const items = pubs.items as Json[];
    expect(items).toHaveLength(10);
    expect(items[0]!.entity_ref).toBe('pub:11');
  });

  it('filters the series section to the requested sources', async () => {
    const { parsed } = await runOverview({ sections: ['series'], sources: ['gsc'] });
    const s = parsed.series as Json[];
    expect(s).toHaveLength(2);
    expect(s.every((row) => row.source === 'gsc')).toBe(true);
  });

  it('maps a period preset to a from/to window, and explicit from/to win', async () => {
    const { session, calls } = buildSession([overviewResponse(), overviewResponse()]);
    await session.setActiveProduct(147, 'Visibilio');
    const tool = await findTool('get_measurement_overview');

    await tool.handler({ period: 'last_28_days' }, session);
    const p1 = Object.fromEntries(new URL(calls[0]!.url).searchParams);
    expect(p1.view).toBe('summary');
    expect(windowDaysInclusive(p1.from!, p1.to!)).toBe(28);

    await tool.handler({ period: 'last_28_days', from: '2026-10-06', to: '2026-10-12' }, session);
    const p2 = Object.fromEntries(new URL(calls[1]!.url).searchParams);
    expect(p2.from).toBe('2026-10-06');
    expect(p2.to).toBe('2026-10-12');
  });

  it('bounds page and page_size', async () => {
    const tool = await findTool('get_measurement_overview');
    const pageSize = tool.inputSchema.page_size!;
    const page = tool.inputSchema.page!;
    expect(pageSize.safeParse(0).success).toBe(false);
    expect(pageSize.safeParse(51).success).toBe(false);
    expect(pageSize.safeParse(1).success).toBe(true);
    expect(pageSize.safeParse(50).success).toBe(true);
    expect(page.safeParse(0).success).toBe(false);
    expect(page.safeParse(-1).success).toBe(false);
    expect(page.safeParse(1).success).toBe(true);
  });

  it('a feature-flag 404 is explained instead of surfacing as a bare error, as a failed result', async () => {
    const { session } = buildSession([
      {
        match: pathMatcher('GET', '/api/v2/measurement/overview'),
        status: 404,
        body: { error: 'Not Found' },
      },
    ]);
    await session.setActiveProduct(147, 'Visibilio');

    const result = await callTool('get_measurement_overview', {}, session);

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(
      'Measurement overview is not enabled for this organization yet (gateway returned 404).'
    );
  });
});

describe('measurement recommendations', () => {
  it('list_measurement_recommendations forwards state and product', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('GET', '/api/v2/measurement/recommendations'),
        body: {
          data: [
            {
              id: 4,
              rule_id: 'refresh_top_page',
              reason: 'Traffic dropped 30%',
              state: 'open',
              recommended_topic: 'Refresh the pricing page',
            },
          ],
        },
      },
    ]);
    await session.setActiveProduct(147, 'Visibilio');

    const text = await (
      await findTool('list_measurement_recommendations')
    ).handler({ state: 'open' }, session);

    expect(Object.fromEntries(new URL(calls[0]!.url).searchParams)).toEqual({
      productId: '147',
      state: 'open',
    });
    expect(text).toContain('Refresh the pricing page');
    expect(text).toContain('recommendation_id: 4');
  });

  it('renders the title of an object-shaped recommended_topic, never "[object Object]"', async () => {
    const { session } = buildSession([
      {
        match: pathMatcher('GET', '/api/v2/measurement/recommendations'),
        body: {
          data: [
            {
              id: 7,
              rule_id: 'repeat_top_topic_format',
              reason: 'Your social post content performed best this period.',
              state: 'open',
              recommended_topic: {
                title: 'Follow-up: pricing clarity',
                content_type: 'social_post',
                basis_publication_id: 14,
              },
            },
          ],
        },
      },
    ]);
    await session.setActiveProduct(147, 'Visibilio');

    const text = await (await findTool('list_measurement_recommendations')).handler({}, session);

    expect(text).toContain('Follow-up: pricing clarity');
    expect(text).not.toContain('[object Object]');
  });
});

describe('AI visibility (answer engine)', () => {
  it('get_ai_visibility_metrics reads the product metrics with optional scope filters', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('GET', '/api/v2/answer-engine/products/147/metrics'),
        body: {
          data: {
            cycle: { id: 3, number: 3 },
            metrics: {
              mentionRate: 0.42,
              occurrenceShareOfVoice: 0.2,
              answerCountedShareOfVoice: 0.25,
              coverage: 0.9,
            },
            measurements: [],
            analysis: null,
          },
        },
      },
    ]);
    await session.setActiveProduct(147, 'Visibilio');

    const text = await (
      await findTool('get_ai_visibility_metrics')
    ).handler({ provider: 'openai', question_class: 'unbranded' }, session);

    expect(Object.fromEntries(new URL(calls[0]!.url).searchParams)).toEqual({
      provider: 'openai',
      questionClass: 'unbranded',
    });
    expect(text).toContain('42');
    expect(text).toContain('mention rate');
  });

  it('list_ai_visibility_recommendations lists active recommendations with their gap', async () => {
    const { session } = buildSession([
      {
        match: pathMatcher('GET', '/api/v2/answer-engine/products/147/recommendations'),
        body: {
          data: {
            recommendations: [
              {
                id: 'r1',
                topicName: 'Pricing',
                rule: 'competitor_cited',
                subject: 'acme.test/pricing',
                gapMetricValue: 0.3,
                status: 'active',
              },
            ],
            emptyStateReason: null,
          },
        },
      },
    ]);
    await session.setActiveProduct(147, 'Visibilio');

    const text = await (await findTool('list_ai_visibility_recommendations')).handler({}, session);

    expect(text).toContain('Pricing');
    expect(text).toContain('recommendation_id: r1');
  });

  it('list_ai_visibility_answers forwards paging and mention filters', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('GET', '/api/v2/answer-engine/products/147/answers'),
        body: {
          data: {
            scope: {},
            totals: { included: 10, mentioned: 4 },
            page: 1,
            pageSize: 20,
            total: 10,
            items: [{ question: 'Best MCP server?', provider: 'openai', mentioned: true }],
          },
        },
      },
    ]);
    await session.setActiveProduct(147, 'Visibilio');

    const text = await (
      await findTool('list_ai_visibility_answers')
    ).handler({ mention: 'mentioned', page: 1 }, session);

    expect(Object.fromEntries(new URL(calls[0]!.url).searchParams)).toEqual({
      mention: 'mentioned',
      page: '1',
    });
    expect(text).toContain('Best MCP server?');
  });
});
