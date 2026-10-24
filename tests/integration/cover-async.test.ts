import { describe, it, expect } from 'vitest';
import { buildSession, callTool, jsonBodyOf, pathMatcher, textOf } from './_helpers.js';

/**
 * Async cover generation. A long cover render used to run synchronously and abort
 * at the client after about a minute. generate_cover_image now starts a job and
 * returns its id at once; get_generation_job_status polls the shared
 * content_generation_jobs status read. A status read is idempotent, so a retry
 * never duplicates work.
 */

describe('generate_cover_image — starts an async job and returns the job id', () => {
  it('posts to the async cover route and returns the job id with poll guidance', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('POST', '/content-items/501/generate-cover-async'),
        status: 202,
        body: { job_id: 777, status: 'running' },
      },
    ]);

    const result = await callTool(
      'generate_cover_image',
      { content_item_id: 501, prompt: 'a calm ledger' },
      session
    );

    expect(String(calls[0]?.url)).toContain('/api/v2/content-items/501/generate-cover-async');
    expect(jsonBodyOf(calls[0])).toEqual({ prompt: 'a calm ledger' });
    const text = textOf(result);
    expect(text).toContain('777');
    expect(text).toContain('get_generation_job_status');
  });

  it('forwards user_initiated so a user can replace a user-uploaded cover', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('POST', '/content-items/501/generate-cover-async'),
        status: 202,
        body: { job_id: 778, status: 'running' },
      },
    ]);

    await callTool('generate_cover_image', { content_item_id: 501, user_initiated: true }, session);

    expect(jsonBodyOf(calls[0])).toEqual({ user_initiated: true });
  });
});

describe('get_generation_job_status — polls the shared generation-jobs status', () => {
  it('reports a running job and tells the caller to poll again', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('GET', '/generation-jobs/777'),
        body: {
          data: {
            job_id: 777,
            kind: 'cover',
            status: 'running',
            units_status: { cover: 'running' },
            error: null,
          },
        },
      },
    ]);

    const result = await callTool('get_generation_job_status', { job_id: 777 }, session);

    expect(String(calls[0]?.url)).toContain('/api/v2/generation-jobs/777');
    const text = textOf(result);
    expect(text).toMatch(/running/i);
    expect(text).toContain('get_generation_job_status');
  });

  it('reports a completed job as finished', async () => {
    const { session } = buildSession([
      {
        match: pathMatcher('GET', '/generation-jobs/777'),
        body: {
          data: {
            job_id: 777,
            kind: 'cover',
            status: 'completed',
            units_status: { cover: 'done' },
            error: null,
          },
        },
      },
    ]);

    const result = await callTool('get_generation_job_status', { job_id: 777 }, session);

    expect(textOf(result)).toMatch(/completed/i);
  });

  it('surfaces the error of a failed job', async () => {
    const { session } = buildSession([
      {
        match: pathMatcher('GET', '/generation-jobs/777'),
        body: {
          data: {
            job_id: 777,
            kind: 'cover',
            status: 'failed',
            units_status: { cover: 'error' },
            error: 'Image generation is rate-limited',
          },
        },
      },
    ]);

    const result = await callTool('get_generation_job_status', { job_id: 777 }, session);

    const text = textOf(result);
    expect(text).toMatch(/failed/i);
    expect(text).toContain('Image generation is rate-limited');
  });
});
