import { z } from 'zod';
import {
  defineTool,
  mutating,
  pick,
  readOnly,
  requireNumberArg,
  requireStringArg,
  resolveProductId,
  unwrapData,
  type ToolDefinition,
} from './_define.js';
import { asArray, fields, line, listOrEmpty, nameOf, type Row } from './_format.js';

function planLine(plan: Row): string {
  const period =
    typeof plan.period_start === 'string' && typeof plan.period_end === 'string'
      ? `${plan.period_start} → ${plan.period_end}`
      : undefined;
  return line(nameOf(plan), 'plan_id', plan.id, [
    typeof plan.status === 'string' ? plan.status : undefined,
    period,
  ]);
}

function postsOf(meta: unknown): Row[] {
  return meta && typeof meta === 'object' ? asArray<Row>((meta as Row).posts) : [];
}

function renderPosts(meta: unknown): string {
  const posts = postsOf(meta);
  if (posts.length === 0) return 'Planned posts: none yet.';
  const lines = posts.map(
    (p) =>
      `- ${String(p.date ?? '?')} · ${String(p.platform ?? '?')} · ${String(p.topic ?? p.description ?? '')}${p.pillar ? ` (pillar: ${String(p.pillar)})` : ''}`
  );
  return `Planned posts (${posts.length} posts):\n${lines.join('\n')}`;
}

function describePlan(plan: Row): string {
  return [
    fields([
      ['Plan', plan.name],
      ['plan_id', plan.id],
      ['status', plan.status],
      ['description', plan.description],
      [
        'period',
        typeof plan.period_start === 'string'
          ? `${plan.period_start} → ${String(plan.period_end ?? '?')}`
          : undefined,
      ],
      ['user_input', plan.user_input],
      [
        'execution_id',
        plan.__metrics && typeof plan.__metrics === 'object'
          ? (plan.__metrics as Row).execution_id
          : undefined,
      ],
    ]),
    renderPosts(plan.__meta),
  ].join('\n');
}

const listContentPlans = defineTool({
  name: 'list_content_plans',
  title: 'List content plans',
  description:
    'List the content plans (editorial calendars) of a product with their status and period.',
  inputSchema: {
    product_id: z.number().int().optional().describe('Defaults to the active product'),
    status: z
      .enum(['pending', 'processing', 'completed', 'failed', 'regenerating', 'proposed'])
      .optional(),
    limit: z.number().int().min(1).max(100).optional(),
    offset: z.number().int().min(0).optional(),
  },
  annotations: readOnly,
  handler: async (args, session) => {
    const productId = resolveProductId(args, session);
    const plans = asArray<Row>(
      unwrapData(
        await session.client.get(
          `/api/v2/products/${productId}/content-plans`,
          pick(args, ['status', 'limit', 'offset']) as Record<string, string | number>
        )
      )
    );
    return listOrEmpty(
      `Content plans (${plans.length}):`,
      plans.map(planLine),
      'No content plans yet. Create one with create_content_plan.'
    );
  },
});

const getContentPlan = defineTool({
  name: 'get_content_plan',
  title: 'Get content plan',
  description: 'Read a content plan with its planned posts (date, platform, topic, pillar).',
  inputSchema: { plan_id: z.number().int(), product_id: z.number().int().optional() },
  annotations: readOnly,
  handler: async (args, session) => {
    const productId = resolveProductId(args, session);
    const planId = requireNumberArg(args, 'plan_id');
    return describePlan(
      unwrapData<Row>(
        await session.client.get(`/api/v2/products/${productId}/content-plans/${planId}`)
      )
    );
  },
});

const createContentPlan = defineTool({
  name: 'create_content_plan',
  title: 'Create content plan',
  description: 'Create an empty content plan for a product. Fill it with generate_content_plan.',
  inputSchema: {
    product_id: z.number().int().optional(),
    name: z.string().min(1),
    description: z.string().optional(),
    user_input: z
      .string()
      .max(500)
      .optional()
      .describe('Guidance for the planner (themes, campaigns, constraints)'),
  },
  annotations: mutating,
  handler: async (args, session) => {
    const productId = resolveProductId(args, session);
    requireStringArg(args, 'name');
    const plan = unwrapData<Row>(
      await session.client.post(
        `/api/v2/products/${productId}/content-plans`,
        pick(args, ['name', 'description', 'user_input'])
      )
    );
    return `Content plan created.\n${describePlan(plan)}\nNext: generate_content_plan(plan_id: ${String(plan.id)}, start_date, end_date).`;
  },
});

const generateContentPlan = defineTool({
  name: 'generate_content_plan',
  title: 'Generate content plan',
  description:
    'Have the planner fill a content plan with dated, platform-specific topics for a window. Returns an execution id; poll get_content_plan_status until it is completed (1-3 minutes).',
  inputSchema: {
    product_id: z.number().int().optional(),
    plan_id: z.number().int(),
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    platforms: z
      .array(z.string())
      .optional()
      .describe('Subset of the connected channels, e.g. ["linkedin","blog"]'),
    content_pillars: z.array(z.string()).optional(),
    total_posts: z.number().int().min(1).max(200).optional(),
    include_hashtags: z.boolean().optional(),
  },
  annotations: mutating,
  handler: async (args, session) => {
    const productId = resolveProductId(args, session);
    const planId = requireNumberArg(args, 'plan_id');
    const result = unwrapData<Row>(
      await session.client.post(
        `/api/v2/products/${productId}/content-plans/${planId}/generate`,
        pick(args, [
          'start_date',
          'end_date',
          'platforms',
          'content_pillars',
          'total_posts',
          'include_hashtags',
        ])
      )
    );
    return [
      `Plan generation started: execution_id ${String(result.execution_id)} (${String(result.status)}).`,
      `Poll get_content_plan_status(plan_id: ${planId}) until status is completed; polling is what finalizes the plan.`,
    ].join('\n');
  },
});

const getContentPlanStatus = defineTool({
  name: 'get_content_plan_status',
  title: 'Get content plan status',
  description:
    'Poll a generating content plan. When generation is done this call finalizes the plan and returns its posts.',
  inputSchema: { plan_id: z.number().int(), product_id: z.number().int().optional() },
  annotations: readOnly,
  handler: async (args, session) => {
    const productId = resolveProductId(args, session);
    const planId = requireNumberArg(args, 'plan_id');
    const status = unwrapData<Row>(
      await session.client.get(`/api/v2/products/${productId}/content-plans/${planId}/status`)
    );
    const head = fields([
      ['plan_id', planId],
      ['status', status.status],
      ['error', status.error],
    ]);
    if (status.status === 'processing')
      return `${head}\nStill generating; poll again in a few seconds.`;
    return `${head}\n${renderPosts(status.__meta)}`;
  },
});

const listPlannedTopics = defineTool({
  name: 'list_planned_topics',
  title: 'List planned topics',
  description:
    'List the planned topics (calendar entries) of a product in a date window, with their status and generated content items.',
  inputSchema: {
    product_id: z.number().int().optional(),
    from: z.string().optional().describe('ISO date, inclusive'),
    to: z.string().optional().describe('ISO date, exclusive'),
  },
  annotations: readOnly,
  handler: async (args, session) => {
    const productId = resolveProductId(args, session);
    const topics = asArray<Row>(
      unwrapData(
        await session.client.get(
          `/api/v2/products/${productId}/planned-topics`,
          pick(args, ['from', 'to']) as Record<string, string>
        )
      )
    );
    return listOrEmpty(
      `Planned topics (${topics.length}):`,
      topics.map((t) =>
        line(nameOf(t), 'topic_id', t.id, [
          typeof t.planned_at === 'string' ? t.planned_at.slice(0, 10) : undefined,
          typeof t.status === 'string' ? t.status : undefined,
          typeof t.pillar === 'string' ? `pillar: ${t.pillar}` : undefined,
          Array.isArray(t.content_item_ids) && t.content_item_ids.length
            ? `content_item_ids: ${(t.content_item_ids as unknown[]).join(', ')}`
            : undefined,
        ])
      ),
      'No planned topics in this window.'
    );
  },
});

const getPlannedTopicBrief = defineTool({
  name: 'get_planned_topic_brief',
  title: 'Get planned topic brief',
  description: 'Read (or compose, on first call) the writing brief for a planned topic.',
  inputSchema: { topic_id: z.number().int(), product_id: z.number().int().optional() },
  annotations: readOnly,
  handler: async (args, session) => {
    const productId = resolveProductId(args, session);
    const topicId = requireNumberArg(args, 'topic_id');
    const brief = unwrapData<unknown>(
      await session.client.get(`/api/v2/products/${productId}/planned-topics/${topicId}/brief`)
    );
    return brief ? JSON.stringify(brief, null, 2) : 'No brief available for this topic.';
  },
});

export const contentPlanTools: readonly ToolDefinition[] = [
  listContentPlans,
  getContentPlan,
  createContentPlan,
  generateContentPlan,
  getContentPlanStatus,
  listPlannedTopics,
  getPlannedTopicBrief,
];
