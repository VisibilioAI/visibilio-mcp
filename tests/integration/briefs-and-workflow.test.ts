import { describe, it, expect } from 'vitest';
import { z, type ZodTypeAny } from 'zod';
import { buildSession, callTool, findTool, jsonBodyOf, pathMatcher, textOf } from './_helpers.js';

function enumValuesOf(schema: ZodTypeAny | undefined): readonly string[] | undefined {
  const inner = schema instanceof z.ZodOptional ? schema.unwrap() : schema;
  return inner instanceof z.ZodEnum ? inner.options : undefined;
}

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

  it('list_briefs reports a filtered-empty result without claiming the account is empty', async () => {
    const { session } = buildSession([
      { match: pathMatcher('GET', '/api/v2/briefs'), body: { data: [] } },
    ]);

    const text = await (await findTool('list_briefs')).handler({ status: 'draft' }, session);

    expect(text).toContain('No briefs match the filter');
    expect(text).not.toContain('create_brief');
  });

  it('list_briefs keeps the create hint when no filter was supplied and none exist', async () => {
    // Regression guard — already passes; locks in the genuinely-empty message.
    const { session } = buildSession([
      { match: pathMatcher('GET', '/api/v2/briefs'), body: { data: [] } },
    ]);

    const text = await (await findTool('list_briefs')).handler({}, session);

    expect(text).toContain('No briefs yet. Create one with create_brief.');
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

  it('get_brief reads one brief in full', async () => {
    const { session, calls } = buildSession([
      { match: pathMatcher('GET', '/api/v2/briefs/31'), body: { data: BRIEF } },
    ]);

    const text = await (await findTool('get_brief')).handler({ brief_id: 31 }, session);

    expect(calls[0]!.url).toContain('/api/v2/briefs/31');
    expect(text).toContain('Brief: Launch post');
    expect(text).toContain('brief_id: 31');
    expect(text).toContain('status: draft');
  });

  it('delete_brief issues DELETE and confirms the deletion', async () => {
    const { session, calls } = buildSession([
      { match: pathMatcher('DELETE', '/api/v2/briefs/31'), body: { data: { id: 31 } } },
    ]);

    const result = await callTool('delete_brief', { brief_id: 31 }, session);

    expect(calls[0]!.init?.method).toBe('DELETE');
    expect(calls[0]!.url).toContain('/api/v2/briefs/31');
    expect(textOf(result)).toBe('Brief 31 deleted.');
  });

  it('list_brief_content_items lists each linked content item with its id', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('GET', '/api/v2/briefs/31/content-items'),
        body: {
          data: [
            {
              content_item_id: 501,
              content_item: { id: 501, title: 'Draft from brief', type: 'article', status: 'draft' },
            },
          ],
        },
      },
    ]);

    const text = await (
      await findTool('list_brief_content_items')
    ).handler({ brief_id: 31 }, session);

    expect(calls[0]!.url).toContain('/api/v2/briefs/31/content-items');
    expect(text).toContain('Content items linked to brief 31:');
    expect(text).toContain('Draft from brief');
    expect(text).toContain('content_item_id: 501');
  });

  it('list_brief_content_items reports an empty brief without claiming it does not exist', async () => {
    const { session } = buildSession([
      { match: pathMatcher('GET', '/api/v2/briefs/31/content-items'), body: { data: [] } },
    ]);

    const text = await (
      await findTool('list_brief_content_items')
    ).handler({ brief_id: 31 }, session);

    expect(text).toContain('No content items linked to this brief yet.');
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

  it('start_workflow advertises an optional language with the values of create_content_item and states the default', async () => {
    const startWorkflow = await findTool('start_workflow');
    const createContentItem = await findTool('create_content_item');
    const savedLanguages = enumValuesOf(createContentItem.inputSchema.language);

    expect(savedLanguages).toBeDefined();
    expect(startWorkflow.inputSchema.language?.isOptional()).toBe(true);
    expect(enumValuesOf(startWorkflow.inputSchema.language)).toEqual(savedLanguages);
    expect(startWorkflow.description).toContain(
      "When language is omitted, Visibilio uses the product's default language."
    );
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

  it('get_workflow_status labels a cancelled run reason as cancel_reason, not error', async () => {
    const { session } = buildSession([
      {
        match: pathMatcher('GET', '/api/v2/workflow/exec-7/status'),
        body: {
          execution_id: 'exec-7',
          state: 'cancelled',
          is_complete: true,
          error: 'Cancelled by user: wrong topic',
        },
      },
    ]);

    const text = await (
      await findTool('get_workflow_status')
    ).handler({ execution_id: 'exec-7' }, session);

    expect(text).toContain('cancel_reason: Cancelled by user: wrong topic');
    expect(text).not.toContain('error: Cancelled by user');
  });

  // Regression guard — passes at authorship; a genuinely failed run must keep the `error` label.
  it('get_workflow_status keeps the error label for a failed, non-cancelled run', async () => {
    const { session } = buildSession([
      {
        match: pathMatcher('GET', '/api/v2/workflow/exec-8/status'),
        body: {
          execution_id: 'exec-8',
          state: 'failed',
          is_complete: true,
          error: 'Upstream model timeout',
        },
      },
    ]);

    const text = await (
      await findTool('get_workflow_status')
    ).handler({ execution_id: 'exec-8' }, session);

    expect(text).toContain('error: Upstream model timeout');
    expect(text).not.toContain('cancel_reason');
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

  it('cancel_workflow posts the cancellation with the reason and confirms it', async () => {
    const { session, calls } = buildSession([
      { match: pathMatcher('POST', '/api/v2/workflow/exec-1/cancel'), body: { data: {} } },
    ]);

    const result = await callTool(
      'cancel_workflow',
      { execution_id: 'exec-1', reason: 'wrong topic' },
      session
    );

    expect(calls[0]!.url).toContain('/api/v2/workflow/exec-1/cancel');
    expect(jsonBodyOf(calls[0])).toEqual({ reason: 'wrong topic' });
    expect(textOf(result)).toBe('Workflow exec-1 cancelled.');
  });
});
