import { describe, expect, it } from 'vitest';
import type { McpSession } from '../../../src/session.js';
import { runWorkflow } from '../../../src/tools/_workflow.js';

interface FakeBackendCalls {
  starts: Array<{ path: string; body: unknown }>;
  statusFetches: Array<{ path: string }>;
}

function fakeSession(
  responses: Array<{ status: number; body: unknown }>,
  calls: FakeBackendCalls
): McpSession {
  let i = 0;
  const next = () => {
    const r = responses[i++];
    if (!r) throw new Error('fake session ran out of canned responses');
    return r;
  };
  const session = {
    organizationId: 7,
    userId: 42,
    projectId: 'proj_x',
    buildTenantHeaders: () => ({
      'X-User-Id': '42',
      'X-Organization-Id': '7',
      'X-Project-Id': 'proj_x',
    }),
    client: {
      backendPost: async (path: string, body: unknown) => {
        calls.starts.push({ path, body });
        return next().body;
      },
      backendGet: async (path: string) => {
        calls.statusFetches.push({ path });
        return next().body;
      },
    },
  } as unknown as McpSession;
  return session;
}

describe('runWorkflow', () => {
  it('returns an error string when topic is empty (no backend call)', async () => {
    const calls: FakeBackendCalls = { starts: [], statusFetches: [] };
    const session = fakeSession([], calls);
    const out = await runWorkflow(session, {
      contentType: 'linkedin_post',
      topic: '   ',
      timeoutSeconds: 5,
      pollIntervalMs: 1,
    });
    expect(out.toLowerCase()).toContain('topic');
    expect(out.toLowerCase()).toContain('required');
    expect(calls.starts).toHaveLength(0);
  });

  it('starts workflow at /api/v2/workflow/start with topic encoded as natural-language user_request', async () => {
    const calls: FakeBackendCalls = { starts: [], statusFetches: [] };
    const session = fakeSession(
      [
        {
          status: 200,
          body: { execution_id: 'exec_1', state: 'pending', requires_confirmation: false },
        },
        { status: 200, body: { execution_id: 'exec_1', state: 'completed', final_output: 'OK' } },
      ],
      calls
    );
    await runWorkflow(session, {
      contentType: 'linkedin_post',
      topic: 'celebrate Human×AI Europe',
      timeoutSeconds: 5,
      pollIntervalMs: 1,
    });
    expect(calls.starts).toHaveLength(1);
    expect(calls.starts[0]!.path).toBe('/api/v2/workflow/start');
    const body = calls.starts[0]!.body as Record<string, unknown>;
    expect(body.user_request).toBe('Write a LinkedIn post: celebrate Human×AI Europe');
    expect(body.repurpose_targets).toBeUndefined();
    expect(body.auto_confirm).toBe(true);
    expect(body.async_mode).toBe(true);
  });

  it('appends tone and key_points to user_request when provided', async () => {
    const calls: FakeBackendCalls = { starts: [], statusFetches: [] };
    const session = fakeSession(
      [
        { status: 200, body: { execution_id: 'e', state: 'pending' } },
        { status: 200, body: { execution_id: 'e', state: 'completed', final_output: '' } },
      ],
      calls
    );
    await runWorkflow(session, {
      contentType: 'linkedin_post',
      topic: 'product launch',
      tone: 'bold',
      keyPoints: 'shipping today; built in 6 weeks',
      timeoutSeconds: 5,
      pollIntervalMs: 1,
    });
    const body = calls.starts[0]!.body as Record<string, unknown>;
    expect(body.user_request).toBe(
      'Write a LinkedIn post: product launch\nTone: bold\nKey points: shipping today; built in 6 weeks'
    );
  });

  it('maps audienceId to persona_id and includeImage to include_image in the body', async () => {
    const calls: FakeBackendCalls = { starts: [], statusFetches: [] };
    const session = fakeSession(
      [
        { status: 200, body: { execution_id: 'e', state: 'pending' } },
        { status: 200, body: { execution_id: 'e', state: 'completed', final_output: '' } },
      ],
      calls
    );
    await runWorkflow(session, {
      contentType: 'blog_article',
      topic: 'X',
      audienceId: 'persona_42',
      includeImage: true,
      timeoutSeconds: 5,
      pollIntervalMs: 1,
    });
    const body = calls.starts[0]!.body as Record<string, unknown>;
    expect(body.persona_id).toBe('persona_42');
    expect(body.include_image).toBe(true);
  });

  it('uses human-readable label for known content types and falls back to underscore-stripped name', async () => {
    const calls: FakeBackendCalls = { starts: [], statusFetches: [] };
    const session = fakeSession(
      [
        { status: 200, body: { execution_id: 'e1', state: 'pending' } },
        { status: 200, body: { execution_id: 'e1', state: 'completed', final_output: '' } },
        { status: 200, body: { execution_id: 'e2', state: 'pending' } },
        { status: 200, body: { execution_id: 'e2', state: 'completed', final_output: '' } },
      ],
      calls
    );
    await runWorkflow(session, {
      contentType: 'press_release',
      topic: 'launch announcement',
      timeoutSeconds: 5,
      pollIntervalMs: 1,
    });
    await runWorkflow(session, {
      contentType: 'whitepaper_summary',
      topic: 'AI in marketing',
      timeoutSeconds: 5,
      pollIntervalMs: 1,
    });
    expect((calls.starts[0]!.body as Record<string, unknown>).user_request).toBe(
      'Write a press release: launch announcement'
    );
    expect((calls.starts[1]!.body as Record<string, unknown>).user_request).toBe(
      'Write a whitepaper summary: AI in marketing'
    );
  });

  it('polls /workflow/{id}/status until completed and returns final_output', async () => {
    const calls: FakeBackendCalls = { starts: [], statusFetches: [] };
    const session = fakeSession(
      [
        { status: 200, body: { execution_id: 'exec_2', state: 'pending' } },
        { status: 200, body: { execution_id: 'exec_2', state: 'running' } },
        { status: 200, body: { execution_id: 'exec_2', state: 'running' } },
        {
          status: 200,
          body: { execution_id: 'exec_2', state: 'completed', final_output: 'final text' },
        },
      ],
      calls
    );
    const out = await runWorkflow(session, {
      contentType: 'tweet',
      topic: 'short brief',
      timeoutSeconds: 5,
      pollIntervalMs: 1,
    });
    expect(calls.statusFetches.map((c) => c.path)).toEqual([
      '/api/v2/workflow/exec_2/status',
      '/api/v2/workflow/exec_2/status',
      '/api/v2/workflow/exec_2/status',
    ]);
    expect(out).toContain('final text');
  });

  it('returns timeout-explanatory string with execution_id when timeoutSeconds elapses', async () => {
    const calls: FakeBackendCalls = { starts: [], statusFetches: [] };
    const session = fakeSession(
      [
        { status: 200, body: { execution_id: 'exec_3', state: 'pending' } },
        { status: 200, body: { execution_id: 'exec_3', state: 'running' } },
        { status: 200, body: { execution_id: 'exec_3', state: 'running' } },
        { status: 200, body: { execution_id: 'exec_3', state: 'running' } },
      ],
      calls
    );
    const out = await runWorkflow(session, {
      contentType: 'blog_article',
      topic: 'long-form piece',
      timeoutSeconds: 0.005,
      pollIntervalMs: 2,
    });
    expect(out).toContain('exec_3');
    expect(out.toLowerCase()).toMatch(/timeout|still running|get_workflow_status/);
  });

  it('formats backend HTTP error from start as a tool string (does not throw)', async () => {
    const session = {
      organizationId: 7,
      userId: 42,
      projectId: null,
      buildTenantHeaders: () => ({ 'X-User-Id': '42', 'X-Organization-Id': '7' }),
      client: {
        backendPost: async () => {
          const err = new Error('Bad Request') as Error & { status?: number };
          err.status = 400;
          throw err;
        },
        backendGet: async () => {
          throw new Error('not reached');
        },
      },
    } as unknown as McpSession;
    const out = await runWorkflow(session, {
      contentType: 'linkedin_post',
      topic: 'x',
      timeoutSeconds: 5,
      pollIntervalMs: 1,
    });
    expect(out.toLowerCase()).toContain('error');
  });
});
