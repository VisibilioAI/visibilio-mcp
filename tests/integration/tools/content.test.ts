import { describe, expect, it } from 'vitest';
import type { McpSession } from '../../../src/session.js';
import { contentTools } from '../../../src/tools/content.js';

function findTool(name: string) {
  const t = contentTools.find((x) => x.name === name);
  if (!t) throw new Error(`tool ${name} not found in contentTools`);
  return t;
}

function sessionThatFakesWorkflow(finalOutput: string): McpSession {
  let stage = 0;
  return {
    organizationId: 7,
    userId: 42,
    projectId: null,
    buildTenantHeaders: () => ({ 'X-User-Id': '42', 'X-Organization-Id': '7' }),
    client: {
      backendPost: async () => ({
        execution_id: 'exec_stub',
        state: 'pending',
        requires_confirmation: false,
      }),
      backendGet: async () => ({
        execution_id: 'exec_stub',
        state: stage++ === 0 ? 'running' : 'completed',
        final_output: finalOutput,
      }),
    },
  } as unknown as McpSession;
}

describe('write_linkedin_post', () => {
  it('returns the workflow final_output when given a brief', async () => {
    const tool = findTool('write_linkedin_post');
    const session = sessionThatFakesWorkflow('Generated LinkedIn post text');
    const out = await tool.handler(
      { brief: 'celebrate Human×AI Europe', timeout_seconds: 2 },
      session
    );
    expect(out).toContain('Generated LinkedIn post text');
  });

  it('signals the linkedin_post writer through user_request natural language', async () => {
    const tool = findTool('write_linkedin_post');
    const calls: Array<unknown> = [];
    const session = {
      organizationId: 7,
      userId: 42,
      projectId: null,
      buildTenantHeaders: () => ({ 'X-User-Id': '42', 'X-Organization-Id': '7' }),
      client: {
        backendPost: async (_path: string, body: unknown) => {
          calls.push(body);
          return { execution_id: 'e', state: 'pending' };
        },
        backendGet: async () => ({
          execution_id: 'e',
          state: 'completed',
          final_output: 'x',
        }),
      },
    } as unknown as McpSession;
    await tool.handler({ brief: 'b', timeout_seconds: 2 }, session);
    const body = calls[0] as Record<string, unknown>;
    expect(body.user_request).toBe('Write a LinkedIn post: b');
    expect(body.repurpose_targets).toBeUndefined();
  });
});

describe('contentTools registry', () => {
  it('exposes all 12 writers as live ToolDescriptors (not stubs)', () => {
    const expected = [
      'write_linkedin_post',
      'write_blog_article',
      'write_tweet',
      'write_facebook_post',
      'write_newsletter',
      'write_press_release',
      'write_email_campaign',
      'write_instagram_caption',
      'write_youtube_description',
      'write_tiktok_script',
      'write_website_copy',
      'write_ad_copy',
    ];
    const actual = contentTools.map((t) => t.name).sort();
    expect(actual).toEqual(expected.sort());
  });
});
