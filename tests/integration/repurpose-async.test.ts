import { describe, it, expect } from 'vitest';
import { buildSession, callTool, jsonBodyOf, pathMatcher, textOf } from './_helpers.js';

/**
 * Async repurpose. Repurposing a content item into platform-adapted variants runs
 * several generations and used to run synchronously, aborting at the client after
 * about a minute. repurpose_content_item now starts a job and returns its id at once;
 * get_generation_job_status polls the shared content_generation_jobs status read, and
 * the variants are saved as drafts when the job completes. A status read is idempotent,
 * so a retry never duplicates work.
 */

describe('repurpose_content_item — starts an async job and returns the job id', () => {
  it('posts to the async repurpose route and returns the job id with poll guidance', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('POST', '/content-items/501/repurpose-async'),
        status: 202,
        body: { job_id: 777, status: 'running' },
      },
    ]);

    const result = await callTool(
      'repurpose_content_item',
      {
        content_item_id: 501,
        targets: [{ platform: 'linkedin', content_type: 'social_post', remix_strategy: 'adapt' }],
        additional_context: 'keep it punchy',
      },
      session
    );

    expect(String(calls[0]?.url)).toContain('/api/v2/content-items/501/repurpose-async');
    expect(jsonBodyOf(calls[0])).toEqual({
      targets: [{ platform: 'linkedin', content_type: 'social_post', remix_strategy: 'adapt' }],
      additional_context: 'keep it punchy',
    });
    const text = textOf(result);
    expect(text).toContain('777');
    expect(text).toContain('get_generation_job_status');
  });

  it('forwards the optional language', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('POST', '/content-items/501/repurpose-async'),
        status: 202,
        body: { job_id: 778, status: 'running' },
      },
    ]);

    await callTool(
      'repurpose_content_item',
      {
        content_item_id: 501,
        targets: [{ platform: 'x', content_type: 'social_post', remix_strategy: 'split' }],
        language: 'de',
      },
      session
    );

    expect(jsonBodyOf(calls[0])).toEqual({
      targets: [{ platform: 'x', content_type: 'social_post', remix_strategy: 'split' }],
      language: 'de',
    });
  });
});
