import { z } from 'zod';
import { HttpError } from '../client.js';
import {
  defineTool,
  pick,
  readOnly,
  resolveProductId,
  toolFailure,
  unwrapData,
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

const getMeasurementOverview = defineTool({
  name: 'get_measurement_overview',
  title: 'Get measurement overview',
  description:
    'Performance overview for a product over a window: publications, impressions, engagement, followers, website sessions, search, top publications and pages.',
  inputSchema: {
    product_id: z.number().int().optional().describe('Defaults to the active product'),
    from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  },
  annotations: readOnly,
  handler: async (args, session) => {
    const productId = resolveProductId(args, session);
    return gated('Measurement overview', async () => {
      const overview = unwrapData<Row>(
        await session.client.get('/api/v2/measurement/overview', {
          productId,
          ...(pick(args, ['from', 'to']) as Record<string, string>),
        })
      );
      return JSON.stringify(overview, null, 2);
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
          line(
            String(r.recommended_topic ?? r.rule_id ?? 'Recommendation'),
            'recommendation_id',
            r.id,
            [
              typeof r.reason === 'string' ? r.reason : undefined,
              typeof r.state === 'string' ? r.state : undefined,
            ]
          )
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
    cycle: z.number().int().optional(),
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
