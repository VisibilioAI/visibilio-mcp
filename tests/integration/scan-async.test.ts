import { describe, it, expect } from 'vitest';
import { buildSession, callTool, jsonBodyOf, pathMatcher, textOf } from './_helpers.js';

/**
 * Async source scan. Scanning a source crawls and scores its items, which runs
 * ~40s mean / ~180s max and used to run synchronously, aborting at the client after
 * about a minute. scan_source now starts a job and returns its id at once;
 * get_generation_job_status polls the shared content_generation_jobs status read, and
 * the scored items land as signals (seen via list_signals) when the job completes. A
 * retry never rescans the source twice (the job is idempotent per source + product).
 */

describe('scan_source — starts an async job and returns the job id', () => {
  it('posts to the async scan route with the active product and returns the job id with poll guidance', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('POST', '/api/v2/sources/5/scan-async'),
        status: 202,
        body: { job_id: 601, status: 'running' },
      },
    ]);
    await session.setActiveProduct(147, 'Visibilio');

    const result = await callTool('scan_source', { source_id: 5 }, session);

    expect(String(calls[0]?.url)).toContain('/api/v2/sources/5/scan-async');
    expect(jsonBodyOf(calls[0])).toEqual({ product_id: 147 });
    const text = textOf(result);
    expect(text).toContain('601');
    expect(text).toContain('get_generation_job_status');
  });

  it('forwards an explicit product_id', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('POST', '/api/v2/sources/9/scan-async'),
        status: 202,
        body: { job_id: 602, status: 'running' },
      },
    ]);

    await callTool('scan_source', { source_id: 9, product_id: 42 }, session);

    expect(String(calls[0]?.url)).toContain('/api/v2/sources/9/scan-async');
    expect(jsonBodyOf(calls[0])).toEqual({ product_id: 42 });
  });
});
