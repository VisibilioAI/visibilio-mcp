import { describe, it, expect } from 'vitest';
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
      { date: '2026-10-14', platform: 'linkedin', topic: 'MCP launch', pillar: 'product', contentType: 'social_post' },
      { date: '2026-10-16', platform: 'blog', topic: 'Why MCP', pillar: 'education', contentType: 'article' },
    ],
  },
  __metrics: { execution_id: 'exec-5', cost_usd: 0.4 },
};

describe('content plans', () => {
  it('list_content_plans reads the product route and lists plans with status and period', async () => {
    const { session, calls } = buildSession([
      { match: pathMatcher('GET', '/api/v2/products/147/content-plans'), body: { data: [PLAN] } },
    ]);
    session.setActiveProduct(147, 'Visibilio');

    const text = await (await findTool('list_content_plans')).handler({ status: 'completed' }, session);

    expect(Object.fromEntries(new URL(calls[0]!.url).searchParams)).toEqual({ status: 'completed' });
    expect(text).toContain('October plan');
    expect(text).toContain('plan_id: 12');
    expect(text).toContain('2026-10-01');
  });

  it('get_content_plan renders the planned posts from __meta', async () => {
    const { session } = buildSession([
      { match: pathMatcher('GET', '/api/v2/products/147/content-plans/12'), body: { data: PLAN } },
    ]);
    session.setActiveProduct(147, 'Visibilio');

    const text = await (await findTool('get_content_plan')).handler({ plan_id: 12 }, session);

    expect(text).toContain('2026-10-14');
    expect(text).toContain('linkedin');
    expect(text).toContain('MCP launch');
    expect(text).toContain('2 posts');
  });

  it('create_content_plan posts name, description and user_input', async () => {
    const { session, calls } = buildSession([
      { match: pathMatcher('POST', '/api/v2/products/147/content-plans'), status: 201, body: { data: { ...PLAN, id: 13, status: 'pending' } } },
    ]);
    session.setActiveProduct(147, 'Visibilio');

    const text = await (await findTool('create_content_plan')).handler(
      { name: 'November plan', description: 'Growth', user_input: 'focus on case studies' },
      session
    );

    expect(jsonBodyOf(calls[0])).toEqual({ name: 'November plan', description: 'Growth', user_input: 'focus on case studies' });
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
    session.setActiveProduct(147, 'Visibilio');

    const text = await (await findTool('generate_content_plan')).handler(
      { plan_id: 13, start_date: '2026-11-01', end_date: '2026-11-30', platforms: ['linkedin', 'blog'], total_posts: 8 },
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
        body: { data: { status: 'completed', __meta: PLAN.__meta, __metrics: { execution_id: 'exec-7', cost_usd: 0.3 } } },
      },
    ]);
    session.setActiveProduct(147, 'Visibilio');

    const text = await (await findTool('get_content_plan_status')).handler({ plan_id: 13 }, session);

    expect(text).toContain('completed');
    expect(text).toContain('2 posts');
  });

  it('list_planned_topics forwards the date window', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('GET', '/api/v2/products/147/planned-topics'),
        body: { data: [{ id: 5, title: 'MCP launch', planned_at: '2026-10-14T09:00:00Z', status: 'planned', pillar: 'product', content_item_ids: [] }] },
      },
    ]);
    session.setActiveProduct(147, 'Visibilio');

    const text = await (await findTool('list_planned_topics')).handler({ from: '2026-10-01', to: '2026-10-31' }, session);

    expect(Object.fromEntries(new URL(calls[0]!.url).searchParams)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(text).toContain('MCP launch');
    expect(text).toContain('topic_id: 5');
  });
});
