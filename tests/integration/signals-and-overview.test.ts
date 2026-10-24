import { describe, it, expect } from 'vitest';
import { buildSession, findTool, jsonBodyOf, pathMatcher } from './_helpers.js';

const SIGNAL = {
  id: 70,
  product_id: 147,
  source_name: 'TechCrunch',
  source_type: 'rss',
  title: 'MCP adoption doubles',
  summary: 'Adoption is accelerating.',
  url: 'https://news.test/mcp',
  relevance_score: 88,
  topics: ['mcp', 'ai'],
  content_type: 'news',
  suggested_actions: ['write a reaction post'],
  scanned_at: '2026-10-13T06:00:00Z',
  used_in: [],
};

describe('signals and sources', () => {
  it('list_signals scopes to the active product and forwards filters', async () => {
    const { session, calls } = buildSession([
      { match: pathMatcher('GET', '/api/v2/signals'), body: { data: [SIGNAL] } },
    ]);
    await session.setActiveProduct(147, 'Visibilio');

    const text = await (
      await findTool('list_signals')
    ).handler({ min_score: 70, unused_only: true, limit: 10 }, session);

    expect(Object.fromEntries(new URL(calls[0]!.url).searchParams)).toEqual({
      product_id: '147',
      min_score: '70',
      unused_only: 'true',
      limit: '10',
    });
    expect(text).toContain('MCP adoption doubles');
    expect(text).toContain('signal_id: 70');
    expect(text).toContain('88');
  });

  it('generate_from_signal posts output types and reports the execution id', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('POST', '/api/v2/signals/70/generate'),
        status: 202,
        body: { data: { execution_id: 'exec-3', state: 'running', message: 'started' } },
      },
    ]);

    const text = await (
      await findTool('generate_from_signal')
    ).handler(
      {
        signal_id: 70,
        output_types: ['linkedin_post', 'blog_article'],
        additional_context: 'tie to our launch',
      },
      session
    );

    expect(jsonBodyOf(calls[0])).toEqual({
      output_types: ['linkedin_post', 'blog_article'],
      additional_context: 'tie to our launch',
    });
    expect(text).toContain('exec-3');
    expect(text).toContain('get_workflow_status');
  });

  it('dismiss_signal PATCHes the dismiss route', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('PATCH', '/api/v2/signals/70/dismiss'),
        body: { data: { dismissed: true } },
      },
    ]);

    const text = await (await findTool('dismiss_signal')).handler({ signal_id: 70 }, session);

    expect(calls[0]!.init?.method).toBe('PATCH');
    expect(text).toMatch(/dismissed/);
  });

  it('scan_source starts an async job with the active product and returns the job id', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('POST', '/api/v2/sources/5/scan-async'),
        status: 202,
        body: { job_id: 601, status: 'running' },
      },
    ]);
    await session.setActiveProduct(147, 'Visibilio');

    const text = await (await findTool('scan_source')).handler({ source_id: 5 }, session);

    expect(jsonBodyOf(calls[0])).toEqual({ product_id: 147 });
    expect(text).toContain('601');
    expect(text).toContain('get_generation_job_status');
  });

  it('create_source posts the source definition', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('POST', '/api/v2/sources'),
        status: 201,
        body: { data: { id: 6, name: 'Blog feed', type: 'rss', url: 'https://x.test/feed' } },
      },
    ]);

    const text = await (
      await findTool('create_source')
    ).handler({ name: 'Blog feed', type: 'rss', url: 'https://x.test/feed' }, session);

    expect(jsonBodyOf(calls[0])).toEqual({
      name: 'Blog feed',
      type: 'rss',
      url: 'https://x.test/feed',
    });
    expect(text).toContain('source_id: 6');
  });
});

describe('overview', () => {
  it('get_daily_briefing passes orgId and productId as the route expects', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('GET', '/api/v2/dashboard/briefing'),
        body: {
          data: {
            executive_overview: 'Quiet week, one strong signal.',
            key_developments: [
              {
                signal_id: 70,
                title: 'MCP adoption doubles',
                relevance_score: 88,
                url: 'https://news.test/mcp',
              },
            ],
          },
        },
      },
    ]);
    await session.setActiveProduct(147, 'Visibilio');

    const text = await (await findTool('get_daily_briefing')).handler({}, session);

    expect(Object.fromEntries(new URL(calls[0]!.url).searchParams)).toEqual({
      orgId: '7',
      productId: '147',
    });
    expect(text).toContain('Quiet week');
    expect(text).toContain('MCP adoption doubles');
  });

  it('get_review_queue reads the org route and lists items awaiting review', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('GET', '/api/v2/organizations/7/review-queue'),
        body: {
          data: [
            {
              id: 501,
              status: 'review',
              title: 'Why MCP matters',
              quality_verdict: { risk_score: 12 },
              planned_topic: null,
              issue: false,
            },
          ],
        },
      },
    ]);
    await session.setActiveProduct(147, 'Visibilio');

    const text = await (await findTool('get_review_queue')).handler({}, session);

    expect(calls[0]!.url).toContain('/api/v2/organizations/7/review-queue');
    expect(text).toContain('Why MCP matters');
    expect(text).toContain('content_item_id: 501');
  });

  it('approve_content_item posts to the org review route with the schedule flag', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('POST', '/api/v2/organizations/7/content-items/501/approve'),
        body: { data: { id: 501, status: 'approved' } },
      },
    ]);

    const text = await (
      await findTool('approve_content_item')
    ).handler({ content_item_id: 501, schedule: true }, session);

    expect(jsonBodyOf(calls[0])).toEqual({ schedule: true });
    expect(text).toContain('approved');
  });

  it('request_content_changes posts reason and note', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('POST', '/api/v2/organizations/7/content-items/501/request-changes'),
        status: 202,
        body: { data: { job_id: 'rev-1', status: 'running' } },
      },
    ]);

    const text = await (
      await findTool('request_content_changes')
    ).handler(
      { content_item_id: 501, reason: 'tone', note: 'Too salesy, soften the intro' },
      session
    );

    expect(jsonBodyOf(calls[0])).toEqual({ reason: 'tone', note: 'Too salesy, soften the intro' });
    expect(text).toContain('rev-1');
  });

  it('list_notifications renders unread state and mark_notifications_read posts the id', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('GET', '/api/v2/notifications'),
        body: {
          data: [
            {
              id: 300,
              type: 'content_ready',
              title: 'Draft ready',
              body: 'Your post is ready',
              read: false,
              created_at: '2026-10-13T08:00:00Z',
            },
          ],
          total: 1,
          has_more: false,
        },
      },
      { match: pathMatcher('POST', '/api/v2/notifications/read'), body: { success: true } },
    ]);

    const listed = await (await findTool('list_notifications')).handler({}, session);
    const marked = await (
      await findTool('mark_notifications_read')
    ).handler({ notification_id: 300 }, session);

    expect(listed).toContain('Draft ready');
    expect(listed).toContain('notification_id: 300');
    expect(listed).toMatch(/unread/);
    expect(jsonBodyOf(calls[1])).toEqual({ notification_id: 300 });
    expect(marked).toMatch(/read/);
  });
});
