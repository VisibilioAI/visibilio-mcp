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
  it('starts workflow at /api/v2/workflow/start with the brief and contentType', async () => {
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
      brief: 'celebrate Human×AI Europe',
      timeoutSeconds: 5,
      pollIntervalMs: 1,
    });
    expect(calls.starts).toHaveLength(1);
    expect(calls.starts[0]!.path).toBe('/api/v2/workflow/start');
    const body = calls.starts[0]!.body as Record<string, unknown>;
    expect(body.user_request).toBe('celebrate Human×AI Europe');
    expect(body.repurpose_targets).toEqual(['linkedin_post']);
    expect(body.auto_confirm).toBe(true);
    expect(body.async_mode).toBe(true);
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
      brief: 'short brief',
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
      brief: 'long-form piece',
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
      brief: 'x',
      timeoutSeconds: 5,
      pollIntervalMs: 1,
    });
    expect(out.toLowerCase()).toContain('error');
  });
});
