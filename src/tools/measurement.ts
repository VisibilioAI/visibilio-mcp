import { z } from 'zod';
import { HttpError } from '../client.js';
import {
  defineTool,
  isoDate,
  numberArg,
  pick,
  readOnly,
  resolveProductId,
  stringArg,
  toolFailure,
  unwrapData,
  type ToolArgs,
  type ToolDefinition,
  type ToolFailure,
} from './_define.js';
import { asArray, fields, line, listOrEmpty, nameOf, type Row } from './_format.js';

async function gated<T>(feature: string, call: () => Promise<T>): Promise<T | ToolFailure> {
  try {
    return await call();
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) {
      return toolFailure(
        `${feature} is not enabled for this organization yet (gateway returned 404).`
      );
    }
    throw err;
  }
}

function pct(value: unknown): string | undefined {
  return typeof value === 'number' ? `${Math.round(value * 100)}%` : undefined;
}

function recommendationLabel(row: Row): string {
  const topic = row.recommended_topic;
  if (topic && typeof topic === 'object' && !Array.isArray(topic)) {
    const title = (topic as Row).title;
    if (typeof title === 'string' && title.length > 0) return title;
  }
  if (typeof topic === 'string' && topic.length > 0) return topic;
  if (typeof row.rule_id === 'string' && row.rule_id.length > 0) return row.rule_id;
  return 'Recommendation';
}

const OVERVIEW_SECTIONS = [
  'series',
  'publications',
  'pages',
  'search_queries',
  'search_intent_groups',
  'traffic_sources',
  'times_shown',
  'sources_freshness',
  'connected_accounts',
  'definitions',
] as const;
type OverviewSection = (typeof OVERVIEW_SECTIONS)[number];

const PERIOD_DAYS: Record<string, number> = {
  last_7_days: 7,
  last_28_days: 28,
  last_90_days: 90,
};

const MS_PER_DAY = 86_400_000;
const DEFAULT_PAGE_SIZE = 20;

function yesterdayUtc(): string {
  return new Date(Date.now() - MS_PER_DAY).toISOString().slice(0, 10);
}

function addUtcDays(isoDay: string, days: number): string {
  return new Date(Date.parse(`${isoDay}T00:00:00Z`) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

function asRow(value: unknown): Row | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : null;
}

function compactDelta(value: unknown): Row | null {
  const row = asRow(value);
  if (!row || typeof row.current !== 'number') return null;
  return { current: row.current, prior: row.prior ?? null, delta: row.delta ?? null };
}

function blockValue(value: unknown): unknown {
  const row = asRow(value);
  return row ? (row.value ?? null) : null;
}

function blockDelta(value: unknown): Row | null {
  return compactDelta(blockValue(value));
}

function compactSearch(value: unknown): Row | null {
  const totals = asRow(blockValue(value));
  if (!totals) return null;
  const engine = (name: string): Row | null => {
    const e = asRow(blockValue(totals[name]));
    return e ? { impressions: compactDelta(e.impressions), clicks: compactDelta(e.clicks) } : null;
  };
  return { gsc: engine('gsc'), bing: engine('bing') };
}

function compactPosition(value: unknown): Row | null {
  const row = asRow(value);
  if (!row) return null;
  const current = (name: string): unknown => asRow(blockValue(row[name]))?.current ?? null;
  return { gsc: current('gsc'), bing: current('bing') };
}

function compactWebsiteEngagement(value: unknown): Row | null {
  const v = asRow(blockValue(value));
  if (!v) return null;
  return {
    engaged_sessions: compactDelta(v.engaged_sessions),
    engagement_time_seconds: compactDelta(v.engagement_time_seconds),
    pageviews: compactDelta(v.pageviews),
  };
}

function compactTimesShown(value: unknown): Row | null {
  const v = asRow(blockValue(value));
  if (!v) return null;
  return { total: v.total ?? null, change: v.change ?? null };
}

function compactEntry(entry: Row): Row {
  return {
    entity_ref: entry.entity_ref ?? null,
    title: entry.title ?? null,
    live_url: entry.live_url ?? null,
    channel: entry.channel ?? null,
    impressions: entry.impressions ?? null,
    engagement: entry.engagement ?? null,
    engagement_state: entry.engagement_state ?? null,
    content_item_id: entry.content_item_id ?? null,
    published_at: entry.published_at ?? null,
  };
}

function availability(overview: Row): Row {
  const measuredPages = asRow(overview.measured_pages);
  const searchQueries = asRow(blockValue(overview.search_queries));
  const intentGroups = asRow(blockValue(overview.search_intent_groups));
  const timesShown = asRow(blockValue(overview.times_shown));
  return {
    series: asArray(overview.series).length,
    publications: asArray(overview.measured_publications).length,
    pages: {
      website: asArray(measuredPages?.website).length,
      search: asArray(measuredPages?.search).length,
    },
    search_queries: asArray(searchQueries?.top_queries).length,
    search_intent_groups: asArray(intentGroups?.groups).length,
    definitions: Object.keys(asRow(overview.definitions) ?? {}).length,
    traffic_sources: asArray(blockValue(overview.traffic_sources)).length,
    times_shown_parts: asArray(timesShown?.parts).length,
    sources_freshness: asArray(overview.sources_freshness).length,
  };
}

function summarizeOverview(overview: Row): Row {
  return {
    product_id: overview.product_id ?? null,
    period: overview.period ?? null,
    prior_period: overview.prior_period ?? null,
    published: compactDelta(overview.published),
    active_accessible: compactDelta(overview.active_accessible),
    impressions_total: blockDelta(overview.impressions_total),
    engagement_total: blockDelta(overview.engagement_total),
    organic_vs_paid: blockValue(overview.organic_vs_paid),
    website_sessions: blockDelta(overview.website_sessions),
    website_engagement: compactWebsiteEngagement(overview.website_engagement),
    key_events: blockDelta(overview.key_events),
    search: compactSearch(overview.search),
    search_position: compactPosition(overview.search_position),
    times_shown: compactTimesShown(overview.times_shown),
    ai_assistant_sessions: blockDelta(overview.ai_assistant_sessions),
    followers_state: asRow(overview.followers)?.value_state ?? null,
    top_publications: asArray<Row>(overview.top_publications).map(compactEntry),
    freshness: overview.freshness ?? null,
    empty_state: overview.empty_state ?? null,
    available: availability(overview),
  };
}

interface SectionOptions {
  readonly sources?: readonly string[];
  readonly page?: number;
  readonly pageSize?: number;
}

function paginate(items: readonly unknown[], page?: number, pageSize?: number): Row {
  const size = pageSize ?? DEFAULT_PAGE_SIZE;
  const current = page ?? 1;
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / size));
  const start = (current - 1) * size;
  return {
    page: current,
    page_size: size,
    total,
    total_pages: totalPages,
    items: items.slice(start, start + size),
  };
}

function bySource(rows: readonly Row[], key: string, sources?: readonly string[]): Row[] {
  if (!sources || sources.length === 0) return [...rows];
  return rows.filter((row) => typeof row[key] === 'string' && sources.includes(row[key] as string));
}

function attachSection(
  result: Row,
  section: OverviewSection,
  overview: Row,
  options: SectionOptions
): void {
  const { sources, page, pageSize } = options;
  switch (section) {
    case 'series':
      result.series = bySource(asArray<Row>(overview.series), 'source', sources);
      return;
    case 'publications':
      result.publications = paginate(asArray(overview.measured_publications), page, pageSize);
      return;
    case 'pages': {
      const measuredPages = asRow(overview.measured_pages);
      result.pages = {
        website: paginate(asArray(measuredPages?.website), page, pageSize),
        search: paginate(asArray(measuredPages?.search), page, pageSize),
      };
      return;
    }
    case 'search_queries': {
      const queries = asRow(blockValue(overview.search_queries));
      result.search_queries = {
        site_url: queries?.site_url ?? null,
        data_through: queries?.data_through ?? null,
        top_queries: paginate(asArray(queries?.top_queries), page, pageSize),
      };
      return;
    }
    case 'search_intent_groups':
      result.search_intent_groups = blockValue(overview.search_intent_groups);
      return;
    case 'traffic_sources':
      result.traffic_sources = blockValue(overview.traffic_sources);
      return;
    case 'times_shown': {
      const timesShown = asRow(blockValue(overview.times_shown));
      result.times_shown_detail = timesShown
        ? { ...timesShown, parts: bySource(asArray<Row>(timesShown.parts), 'source', sources) }
        : null;
      return;
    }
    case 'sources_freshness':
      result.sources_freshness = bySource(
        asArray<Row>(overview.sources_freshness),
        'connector_type',
        sources
      );
      return;
    case 'connected_accounts':
      result.connected_accounts = overview.connected_accounts ?? null;
      return;
    case 'definitions':
      result.definitions = overview.definitions ?? {};
      return;
  }
}

function parseSections(value: unknown): OverviewSection[] {
  if (!Array.isArray(value)) return [];
  const known = new Set<string>(OVERVIEW_SECTIONS);
  return value.filter((v): v is OverviewSection => typeof v === 'string' && known.has(v));
}

function parseSources(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const sources = value.filter((v): v is string => typeof v === 'string' && v.length > 0);
  return sources.length > 0 ? sources : undefined;
}

function resolveOverviewWindow(args: ToolArgs): Record<string, string> {
  const from = stringArg(args, 'from');
  const to = stringArg(args, 'to');
  if (from || to) {
    return { ...(from ? { from } : {}), ...(to ? { to } : {}) };
  }
  const period = stringArg(args, 'period');
  const days = period ? PERIOD_DAYS[period] : undefined;
  if (days) {
    const end = yesterdayUtc();
    return { from: addUtcDays(end, -(days - 1)), to: end };
  }
  return {};
}

const getMeasurementOverview = defineTool({
  name: 'get_measurement_overview',
  title: 'Get measurement overview',
  description:
    'Compact performance overview for a product over a window: headline tiles (publications, impressions, engagement, website sessions, search), the top publications, and a count of each heavy block available. Request heavy blocks with `sections`; filter by connector with `sources`; pick a window with `period` or `from`/`to`; page long tables with `page`/`page_size`.',
  inputSchema: {
    product_id: z.number().int().optional().describe('Defaults to the active product'),
    from: isoDate('from').optional(),
    to: isoDate('to').optional(),
    period: z
      .enum(['last_7_days', 'last_28_days', 'last_90_days'])
      .optional()
      .describe(
        'Preset window; ignored when from/to are given. Omit for the last 7 completed days.'
      ),
    sections: z
      .array(z.enum(OVERVIEW_SECTIONS))
      .optional()
      .describe('Heavy blocks to include; omit for the compact summary only.'),
    sources: z
      .array(z.string())
      .optional()
      .describe(
        'Filter series, times_shown parts and source freshness to these connectors (e.g. gsc, bing, ga4).'
      ),
    page: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe('Page for list sections (publications, pages, search_queries).'),
    page_size: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .describe('Items per page for list sections (default 20).'),
  },
  annotations: readOnly,
  handler: async (args, session) => {
    const productId = resolveProductId(args, session);
    const sections = parseSections(args.sections);
    const options: SectionOptions = {
      sources: parseSources(args.sources),
      page: numberArg(args, 'page'),
      pageSize: numberArg(args, 'page_size'),
    };
    return gated('Measurement overview', async () => {
      const overview = unwrapData<Row>(
        await session.client.get('/api/v2/measurement/overview', {
          productId,
          view: 'summary',
          ...resolveOverviewWindow(args),
        })
      );
      const result = summarizeOverview(overview);
      for (const section of sections) {
        attachSection(result, section, overview, options);
      }
      return JSON.stringify(result);
    });
  },
});

const listMeasurementRecommendations = defineTool({
  name: 'list_measurement_recommendations',
  title: 'List measurement recommendations',
  description:
    'Data-driven recommendations derived from performance measurement (what to refresh, repeat or stop).',
  inputSchema: {
    product_id: z.number().int().optional(),
    state: z.enum(['open', 'done', 'dismissed']).optional(),
  },
  annotations: readOnly,
  handler: async (args, session) => {
    const productId = resolveProductId(args, session);
    return gated('Measurement recommendations', async () => {
      const rows = asArray<Row>(
        unwrapData(
          await session.client.get('/api/v2/measurement/recommendations', {
            productId,
            ...(pick(args, ['state']) as Record<string, string>),
          })
        )
      );
      return listOrEmpty(
        `Recommendations (${rows.length}):`,
        rows.map((r) =>
          line(recommendationLabel(r), 'recommendation_id', r.id, [
            typeof r.reason === 'string' ? r.reason : undefined,
            typeof r.state === 'string' ? r.state : undefined,
          ])
        ),
        'No recommendations in this state.'
      );
    });
  },
});

const getAiVisibilityMetrics = defineTool({
  name: 'get_ai_visibility_metrics',
  title: 'Get AI visibility metrics',
  description:
    'How often AI assistants mention the product when answering buyer questions: mention rate, share of voice and coverage for the latest (or a given) measurement cycle.',
  inputSchema: {
    product_id: z.number().int().optional(),
    cycle: z.number().int().min(1).optional(),
    provider: z.string().optional().describe('e.g. openai, anthropic, google, perplexity'),
    question_class: z.enum(['unbranded', 'branded']).optional(),
    topic_id: z.string().optional(),
  },
  annotations: readOnly,
  handler: async (args, session) => {
    const productId = resolveProductId(args, session);
    const result = unwrapData<Row>(
      await session.client.get(`/api/v2/answer-engine/products/${productId}/metrics`, {
        ...(pick(args, ['cycle', 'provider']) as Record<string, string | number>),
        ...(typeof args.question_class === 'string' ? { questionClass: args.question_class } : {}),
        ...(typeof args.topic_id === 'string' ? { topic: args.topic_id } : {}),
      })
    );
    const metrics =
      result.metrics && typeof result.metrics === 'object' ? (result.metrics as Row) : null;
    if (!metrics)
      return `No AI visibility measurements yet${result.reason ? ` (${String(result.reason)})` : ''}.`;
    const cycle = result.cycle && typeof result.cycle === 'object' ? (result.cycle as Row) : null;
    return fields([
      ['cycle', cycle ? (cycle.number ?? cycle.id) : undefined],
      ['mention rate', pct(metrics.mentionRate)],
      ['share of voice (occurrences)', pct(metrics.occurrenceShareOfVoice)],
      ['share of voice (answers)', pct(metrics.answerCountedShareOfVoice)],
      ['coverage', pct(metrics.coverage)],
      ['analysis', result.analysis],
    ]);
  },
});

const listAiVisibilityRecommendations = defineTool({
  name: 'list_ai_visibility_recommendations',
  title: 'List AI visibility recommendations',
  description:
    'Recommendations for improving AI assistant visibility: topics where competitors are cited instead of the product.',
  inputSchema: { product_id: z.number().int().optional() },
  annotations: readOnly,
  handler: async (args, session) => {
    const productId = resolveProductId(args, session);
    const result = unwrapData<Row>(
      await session.client.get(`/api/v2/answer-engine/products/${productId}/recommendations`)
    );
    const rows = asArray<Row>(result.recommendations);
    return listOrEmpty(
      `AI visibility recommendations (${rows.length}):`,
      rows.map((r) =>
        line(String(r.topicName ?? 'Topic'), 'recommendation_id', r.id, [
          typeof r.rule === 'string' ? r.rule : undefined,
          typeof r.subject === 'string' ? `subject: ${r.subject}` : undefined,
          typeof r.gapMetricValue === 'number' ? `gap: ${pct(r.gapMetricValue)}` : undefined,
          typeof r.status === 'string' ? r.status : undefined,
        ])
      ),
      `No recommendations${result.emptyStateReason ? ` (${String(result.emptyStateReason)})` : ''}.`
    );
  },
});

const listAiVisibilityContentIdeas = defineTool({
  name: 'list_ai_visibility_content_ideas',
  title: 'List AI visibility content ideas',
  description:
    'Content ideas derived from AI visibility gaps, with their status and linked briefs.',
  inputSchema: { product_id: z.number().int().optional() },
  annotations: readOnly,
  handler: async (args, session) => {
    const productId = resolveProductId(args, session);
    const result = unwrapData<Row>(
      await session.client.get(`/api/v2/answer-engine/products/${productId}/content-ideas`)
    );
    const ideas = asArray<Row>(result.ideas);
    return listOrEmpty(
      `Content ideas (${ideas.length}):`,
      ideas.map((i) =>
        line(nameOf(i), 'idea_id', i.id, [
          typeof i.topicName === 'string' ? i.topicName : undefined,
          typeof i.status === 'string' ? i.status : undefined,
          i.briefId ? `brief_id: ${String(i.briefId)}` : undefined,
        ])
      ),
      'No content ideas yet.'
    );
  },
});

const listAiVisibilityAnswers = defineTool({
  name: 'list_ai_visibility_answers',
  title: 'List AI visibility answers',
  description:
    'The actual AI assistant answers collected for the product questions, filterable by whether the product was mentioned.',
  inputSchema: {
    product_id: z.number().int().optional(),
    mention: z.enum(['included', 'mentioned', 'not_mentioned', 'excluded']).optional(),
    provider: z.string().optional(),
    page: z.number().int().min(1).optional(),
    page_size: z.number().int().min(1).max(50).optional(),
  },
  annotations: readOnly,
  handler: async (args, session) => {
    const productId = resolveProductId(args, session);
    const result = unwrapData<Row>(
      await session.client.get(`/api/v2/answer-engine/products/${productId}/answers`, {
        ...(pick(args, ['mention', 'provider', 'page']) as Record<string, string | number>),
        ...(typeof args.page_size === 'number' ? { pageSize: args.page_size } : {}),
      })
    );
    if (!result.items)
      return `Answers are not ready yet${result.reason ? ` (${String(result.reason)})` : ''}.`;
    return `Page ${String(result.page)} of ${String(result.totalPages ?? '?')} (${String(result.total ?? '?')} answers):\n${JSON.stringify(result.items, null, 2)}`;
  },
});

export const measurementTools: readonly ToolDefinition[] = [
  getMeasurementOverview,
  listMeasurementRecommendations,
  getAiVisibilityMetrics,
  listAiVisibilityRecommendations,
  listAiVisibilityContentIdeas,
  listAiVisibilityAnswers,
];
