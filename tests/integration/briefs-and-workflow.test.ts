import { describe, it, expect } from 'vitest';
import { buildSession, findTool, jsonBodyOf, pathMatcher } from './_helpers.js';

const BRIEF = {
  id: 31,
  title: 'Launch post',
  status: 'draft',
  content_type: 'social_post',
  topic: 'MCP launch',
  target_audience: 'Founders',
  tone: 'confident',
  key_messages: ['works everywhere'],
  references: [],
  notes: '',
  channel_id: null,
  language: 'en',
  product_id: 147,
  created_at: '2026-10-13T10:00:00Z',
};

describe('briefs', () => {
  it('create_brief posts the brief fields and reports the new id', async () => {
    const { session, calls } = buildSession([
      { match: pathMatcher('POST', '/api/v2/briefs'), status: 201, body: { data: BRIEF } },
    ]);

    const text = await (
      await findTool('create_brief')
    ).handler(
      {
        title: 'Launch post',
        content_type: 'social_post',
        topic: 'MCP launch',
        tone: 'confident',
        key_messages: ['works everywhere'],
      },
      session
    );

    expect(jsonBodyOf(calls[0])).toEqual({
      title: 'Launch post',
      content_type: 'social_post',
      topic: 'MCP launch',
      tone: 'confident',
      key_messages: ['works everywhere'],
    });
    expect(text).toContain('brief_id: 31');
  });

  it('create_brief sends the active product, so the brief belongs to it', async () => {
    const { session, calls } = buildSession([
      { match: pathMatcher('POST', '/api/v2/briefs'), status: 201, body: { data: BRIEF } },
    ]);
    await session.setActiveProduct(147, 'Visibilio');

    await (await findTool('create_brief')).handler({ title: 'Launch post' }, session);

    expect(jsonBodyOf(calls[0])).toEqual({ title: 'Launch post', product_id: 147 });
  });

  it('create_brief sends an explicit product_id instead of the active product', async () => {
    const { session, calls } = buildSession([
      { match: pathMatcher('POST', '/api/v2/briefs'), status: 201, body: { data: BRIEF } },
    ]);
    await session.setActiveProduct(147, 'Visibilio');

    await (
      await findTool('create_brief')
    ).handler({ title: 'Launch post', product_id: 200 }, session);

    expect(jsonBodyOf(calls[0])).toEqual({ title: 'Launch post', product_id: 200 });
  });

  it('list_briefs filters by status and content type and lists compact lines', async () => {
    const { session, calls } = buildSession([
      { match: pathMatcher('GET', '/api/v2/briefs'), body: { data: [BRIEF] } },
    ]);

    const text = await (
      await findTool('list_briefs')
    ).handler({ status: 'draft', content_type: 'social_post' }, session);

    expect(Object.fromEntries(new URL(calls[0]!.url).searchParams)).toEqual({
      status: 'draft',
      content_type: 'social_post',
    });
    expect(text).toContain('Launch post');
    expect(text).toContain('brief_id: 31');
  });

  it('generate_from_brief starts generation and tells the model how to follow up', async () => {
    const { session } = buildSession([
      {
        match: pathMatcher('POST', '/api/v2/briefs/31/generate'),
        status: 202,
        body: { data: { brief_id: 31, execution_id: 'exec-9', status: 'in_progress' } },
      },
    ]);

    const text = await (await findTool('generate_from_brief')).handler({ brief_id: 31 }, session);

    expect(text).toContain('exec-9');
    expect(text).toContain('get_workflow_status');
  });

  it('update_brief PUTs only the given fields', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('PUT', '/api/v2/briefs/31'),
        body: { data: { ...BRIEF, status: 'ready' } },
      },
    ]);

    await (
      await findTool('update_brief')
    ).handler({ brief_id: 31, status: 'ready', notes: 'go' }, session);

    expect(jsonBodyOf(calls[0])).toEqual({ status: 'ready', notes: 'go' });
  });
});

describe('workflow', () => {
  it('start_workflow sends the request with the active product and auto_confirm by default', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('POST', '/api/v2/workflow/start'),
        body: {
          execution_id: 'exec-1',
          state: 'running',
          requires_confirmation: false,
          plan: { steps: [{ agent_type: 'linkedin_writer' }] },
        },
      },
    ]);
    await session.setActiveProduct(147, 'Visibilio');

    const text = await (
      await findTool('start_workflow')
    ).handler({ user_request: 'Write a LinkedIn post about our MCP launch' }, session);

    expect(jsonBodyOf(calls[0])).toEqual({
      user_request: 'Write a LinkedIn post about our MCP launch',
      product_id: 147,
      auto_confirm: true,
    });
    expect(text).toContain('exec-1');
    expect(text).toContain('running');
  });

  it('start_workflow sends the language that the caller chooses', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('POST', '/api/v2/workflow/start'),
        body: { execution_id: 'exec-2', state: 'running', requires_confirmation: false },
      },
    ]);
    await session.setActiveProduct(147, 'Visibilio');

    await (
      await findTool('start_workflow')
    ).handler({ user_request: 'Write an article about our MCP launch', language: 'de' }, session);

    expect(jsonBodyOf(calls[0])).toEqual({
      user_request: 'Write an article about our MCP launch',
      product_id: 147,
      auto_confirm: true,
      language: 'de',
    });
  });

  // Regression guard — already passes; locks in current behavior so future refactors cannot regress.
  it('start_workflow without a language sends no language, so the gateway uses the product default', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('POST', '/api/v2/workflow/start'),
        body: { execution_id: 'exec-3', state: 'running', requires_confirmation: false },
      },
    ]);
    await session.setActiveProduct(147, 'Visibilio');

    await (
      await findTool('start_workflow')
    ).handler({ user_request: 'Write an article about our MCP launch' }, session);

    expect(jsonBodyOf(calls[0])).not.toHaveProperty('language');
  });

  it('get_workflow_status says plainly when a completed run produced nothing', async () => {
    const { session } = buildSession([
      {
        match: pathMatcher('GET', '/api/v2/workflow/exec-9/status'),
        body: {
          execution_id: 'exec-9',
          state: 'completed',
          is_complete: true,
          steps: [],
          total_cost_usd: 0,
          final_output: { steps: {}, steps_completed: 0, total_cost_usd: 0 },
        },
      },
    ]);

    const text = await (
      await findTool('get_workflow_status')
    ).handler({ execution_id: 'exec-9' }, session);

    expect(text).toMatch(/produced nothing/i);
    expect(text).toMatch(/rephrase|content type/i);
    expect(text).not.toContain('create_content_item');
  });

  it('get_workflow_status renders the final output and explains how to persist it', async () => {
    const { session } = buildSession([
      {
        match: pathMatcher('GET', '/api/v2/workflow/exec-1/status'),
        body: {
          execution_id: 'exec-1',
          state: 'completed',
          progress_percentage: 100,
          is_complete: true,
          total_cost_usd: 0.12,
          final_output: { title: 'MCP is here', content: 'Body of the post' },
        },
      },
    ]);

    const text = await (
      await findTool('get_workflow_status')
    ).handler({ execution_id: 'exec-1' }, session);

    expect(text).toContain('completed');
    expect(text).toContain('MCP is here');
    expect(text).toContain('Body of the post');
    expect(text).toContain('create_content_item');
    expect(text).toContain('source_execution_id');
  });

  it('confirm_workflow posts the decision', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('POST', '/api/v2/workflow/exec-1/confirm'),
        body: { execution_id: 'exec-1', state: 'running' },
      },
    ]);

    await (
      await findTool('confirm_workflow')
    ).handler({ execution_id: 'exec-1', confirmed: true }, session);

    expect(jsonBodyOf(calls[0])).toEqual({ confirmed: true });
  });
});
