import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { buildSession, findTool, jsonBodyOf, pathMatcher } from './_helpers.js';

const PLAN = {
  id: 12,
  name: 'October plan',
  description: 'Launch month',
  status: 'completed',
  period_start: '2026-10-01',
  period_end: '2026-10-31',
  __meta: {
    posts: [
      {
        date: '2026-10-14',
        platform: 'linkedin',
        topic: 'MCP launch',
        pillar: 'product',
        contentType: 'social_post',
      },
      {
        date: '2026-10-16',
        platform: 'blog',
        topic: 'Why MCP',
        pillar: 'education',
        contentType: 'article',
      },
    ],
  },
  __metrics: { execution_id: 'exec-5', cost_usd: 0.4 },
};

describe('content plans', () => {
  it('list_content_plans reads the product route and lists plans with status and period', async () => {
    const { session, calls } = buildSession([
      { match: pathMatcher('GET', '/api/v2/products/147/content-plans'), body: { data: [PLAN] } },
    ]);
    await session.setActiveProduct(147, 'Visibilio');

    const text = await (
      await findTool('list_content_plans')
    ).handler({ status: 'completed' }, session);

    expect(Object.fromEntries(new URL(calls[0]!.url).searchParams)).toEqual({
      status: 'completed',
    });
    expect(text).toContain('October plan');
    expect(text).toContain('plan_id: 12');
    expect(text).toContain('2026-10-01');
  });

  it('list_content_plans derives the period from the planned posts when period_start/period_end are absent', async () => {
    const uiPlan = {
      id: 20,
      name: 'UI plan',
      status: 'completed',
      __meta: {
        posts: [
          { date: '2026-09-20', platform: 'linkedin', topic: 'B' },
          { date: '2026-10-13', platform: 'blog', topic: 'C' },
          { date: '2026-09-15', platform: 'linkedin', topic: 'A' },
        ],
      },
    };
    const { session } = buildSession([
      { match: pathMatcher('GET', '/api/v2/products/147/content-plans'), body: { data: [uiPlan] } },
    ]);
    await session.setActiveProduct(147, 'Visibilio');

    const text = await (await findTool('list_content_plans')).handler({}, session);

    expect(text).toContain('UI plan');
    expect(text).toContain('2026-09-15 → 2026-10-13');
  });

  it('list_content_plans prefers the explicit period_start/period_end over the posts range', async () => {
    // Regression guard — already passes; locks in that the stored columns win when present,
    // so MCP-finalized plans keep their exact period and the fix cannot override it.
    const { session } = buildSession([
      { match: pathMatcher('GET', '/api/v2/products/147/content-plans'), body: { data: [PLAN] } },
    ]);
    await session.setActiveProduct(147, 'Visibilio');

    const text = await (await findTool('list_content_plans')).handler({}, session);

    expect(text).toContain('2026-10-01 → 2026-10-31');
    expect(text).not.toContain('2026-10-14 → 2026-10-16');
  });

  it('list_content_plans shows no period when a plan has neither stored columns nor posts', async () => {
    // Regression guard — already passes; a plan with nothing to derive from shows no period.
    const emptyPlan = { id: 21, name: 'Empty plan', status: 'pending', __meta: {} };
    const { session } = buildSession([
      {
        match: pathMatcher('GET', '/api/v2/products/147/content-plans'),
        body: { data: [emptyPlan] },
      },
    ]);
    await session.setActiveProduct(147, 'Visibilio');

    const text = await (await findTool('list_content_plans')).handler({}, session);

    expect(text).toContain('Empty plan');
    expect(text).toContain('plan_id: 21');
    expect(text).not.toContain('→');
  });

  it('list_content_plans reports a filtered-empty result without claiming the account is empty', async () => {
    const { session } = buildSession([
      { match: pathMatcher('GET', '/api/v2/products/147/content-plans'), body: { data: [] } },
    ]);
    await session.setActiveProduct(147, 'Visibilio');

    const text = await (
      await findTool('list_content_plans')
    ).handler({ status: 'proposed' }, session);

    expect(text).toContain('No content plans match the filter');
    expect(text).not.toContain('create_content_plan');
  });

  it('list_content_plans keeps the create hint when no filter was supplied and none exist', async () => {
    // Regression guard — already passes; locks in the genuinely-empty message.
    const { session } = buildSession([
      { match: pathMatcher('GET', '/api/v2/products/147/content-plans'), body: { data: [] } },
    ]);
    await session.setActiveProduct(147, 'Visibilio');

    const text = await (await findTool('list_content_plans')).handler({}, session);

    expect(text).toContain('No content plans yet. Create one with create_content_plan.');
  });

  it('get_content_plan renders the planned posts from __meta', async () => {
    const { session } = buildSession([
      { match: pathMatcher('GET', '/api/v2/products/147/content-plans/12'), body: { data: PLAN } },
    ]);
    await session.setActiveProduct(147, 'Visibilio');

    const text = await (await findTool('get_content_plan')).handler({ plan_id: 12 }, session);

    expect(text).toContain('2026-10-14');
    expect(text).toContain('linkedin');
    expect(text).toContain('MCP launch');
    expect(text).toContain('2 posts');
  });

  it('create_content_plan posts name, description and user_input', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('POST', '/api/v2/products/147/content-plans'),
        status: 201,
        body: { data: { ...PLAN, id: 13, status: 'pending' } },
      },
    ]);
    await session.setActiveProduct(147, 'Visibilio');

    const text = await (
      await findTool('create_content_plan')
    ).handler(
      { name: 'November plan', description: 'Growth', user_input: 'focus on case studies' },
      session
    );

    expect(jsonBodyOf(calls[0])).toEqual({
      name: 'November plan',
      description: 'Growth',
      user_input: 'focus on case studies',
    });
    expect(text).toContain('plan_id: 13');
    expect(text).toContain('generate_content_plan');
  });

  it('generate_content_plan sends the window and options and points at the status tool', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('POST', '/api/v2/products/147/content-plans/13/generate'),
        status: 202,
        body: { data: { execution_id: 'exec-7', status: 'processing', message: 'started' } },
      },
    ]);
    await session.setActiveProduct(147, 'Visibilio');

    const text = await (
      await findTool('generate_content_plan')
    ).handler(
      {
        plan_id: 13,
        start_date: '2026-11-01',
        end_date: '2026-11-30',
        platforms: ['linkedin', 'blog'],
        total_posts: 8,
      },
      session
    );

    expect(jsonBodyOf(calls[0])).toEqual({
      start_date: '2026-11-01',
      end_date: '2026-11-30',
      platforms: ['linkedin', 'blog'],
      total_posts: 8,
    });
    expect(text).toContain('exec-7');
    expect(text).toContain('get_content_plan_status');
  });

  it('get_content_plan_status reports completion with the generated posts', async () => {
    const { session } = buildSession([
      {
        match: pathMatcher('GET', '/api/v2/products/147/content-plans/13/status'),
        body: {
          data: {
            status: 'completed',
            __meta: PLAN.__meta,
            __metrics: { execution_id: 'exec-7', cost_usd: 0.3 },
          },
        },
      },
    ]);
    await session.setActiveProduct(147, 'Visibilio');

    const text = await (
      await findTool('get_content_plan_status')
    ).handler({ plan_id: 13 }, session);

    expect(text).toContain('completed');
    expect(text).toContain('2 posts');
  });

  it('list_planned_topics forwards the date window', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('GET', '/api/v2/products/147/planned-topics'),
        body: {
          data: [
            {
              id: 5,
              title: 'MCP launch',
              planned_at: '2026-10-14T09:00:00Z',
              status: 'planned',
              pillar: 'product',
              content_item_ids: [],
            },
          ],
        },
      },
    ]);
    await session.setActiveProduct(147, 'Visibilio');

    const text = await (
      await findTool('list_planned_topics')
    ).handler({ from: '2026-10-01', to: '2026-10-31' }, session);

    expect(Object.fromEntries(new URL(calls[0]!.url).searchParams)).toEqual({
      from: '2026-10-01',
      to: '2026-10-31',
    });
    expect(text).toContain('MCP launch');
    expect(text).toContain('topic_id: 5');
  });

  it('list_planned_topics shows scheduled_date (the plan calendar date), not the UTC date of planned_at', async () => {
    const { session } = buildSession([
      {
        match: pathMatcher('GET', '/api/v2/products/147/planned-topics'),
        body: {
          data: [
            {
              id: 5,
              title: 'MCP launch',
              scheduled_date: '2027-01-11',
              planned_at: '2027-01-10T22:00:00.000Z',
              status: 'planned',
              pillar: 'product',
              content_item_ids: [],
            },
          ],
        },
      },
    ]);
    await session.setActiveProduct(147, 'Visibilio');

    const text = await (await findTool('list_planned_topics')).handler({}, session);

    expect(text).toContain('2027-01-11');
    expect(text).not.toContain('2027-01-10');
  });

  it('list_planned_topics falls back to the planned_at date when scheduled_date is absent', async () => {
    // Regression guard — keeps the pre-gateway-field behaviour safe until the
    // gateway scheduled_date reaches prod.
    const { session } = buildSession([
      {
        match: pathMatcher('GET', '/api/v2/products/147/planned-topics'),
        body: {
          data: [
            {
              id: 5,
              title: 'MCP launch',
              planned_at: '2026-10-14T09:00:00.000Z',
              status: 'planned',
              content_item_ids: [],
            },
          ],
        },
      },
    ]);
    await session.setActiveProduct(147, 'Visibilio');

    const text = await (await findTool('list_planned_topics')).handler({}, session);

    expect(text).toContain('2026-10-14');
  });

  it('get_planned_topic_brief accepts a UUID string topic_id in its input schema', async () => {
    const brief = await findTool('get_planned_topic_brief');
    const schema = z.object(brief.inputSchema);

    const parsed = schema.safeParse({
      topic_id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
      product_id: 147,
    });

    expect(parsed.success).toBe(true);
  });

  it('passes a UUID topic_id from list_planned_topics into get_planned_topic_brief', async () => {
    const topicId = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
    const { session, calls } = buildSession([
      {
        match: pathMatcher('GET', '/products/147/planned-topics'),
        body: {
          data: [
            {
              id: topicId,
              title: 'MCP launch',
              planned_at: '2026-10-14T09:00:00Z',
              status: 'planned',
              pillar: 'product',
              content_item_ids: [],
            },
          ],
        },
      },
      {
        match: pathMatcher('GET', `/planned-topics/${topicId}/brief`),
        body: { data: { topic: 'MCP launch', angle: 'Why MCP matters' } },
      },
    ]);
    await session.setActiveProduct(147, 'Visibilio');

    const listText = await (await findTool('list_planned_topics')).handler({}, session);
    expect(listText).toContain(`topic_id: ${topicId}`);

    const briefText = await (
      await findTool('get_planned_topic_brief')
    ).handler({ topic_id: topicId }, session);

    expect(calls[1]!.url).toContain(`/planned-topics/${topicId}/brief`);
    expect(briefText).toContain('Why MCP matters');
  });
});
