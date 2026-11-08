import { describe, it, expect } from 'vitest';
import { buildSession, callTool, jsonBodyOf, pathMatcher, textOf } from './_helpers.js';

/**
 * Async translate (meta #1070). Translating a content item runs two upstream LLM calls
 * (body + title) and used to run synchronously, aborting at the client after about a
 * minute. translate_content_item now starts a job and returns its id at once;
 * get_generation_job_status polls the shared content_generation_jobs status read, and the
 * translated variant is saved as a linked draft when the job completes.
 *
 * PROD-SAFETY: the public MCP ships before the gateway's /translate-async route reaches
 * prod, so the tool tries /translate-async first and falls back to the synchronous
 * /translate route when the gateway answers 404/405 (route absent). It auto-upgrades to
 * async once the gateway is live.
 */

describe('translate_content_item — async job with sync fallback (meta #1070)', () => {
  it('posts to the async translate route and returns the job id with poll guidance', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('POST', '/content-items/501/translate-async'),
        status: 202,
        body: { job_id: 820, status: 'running' },
      },
    ]);

    const result = await callTool(
      'translate_content_item',
      { content_item_id: 501, target_language: 'bg' },
      session
    );

    expect(String(calls[0]?.url)).toContain('/api/v2/content-items/501/translate-async');
    expect(jsonBodyOf(calls[0])).toEqual({ target_language: 'bg' });
    const text = textOf(result);
    expect(text).toContain('820');
    expect(text).toContain('get_generation_job_status');
  });

  it('falls back to the sync translate route when the gateway has no async route (404)', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('POST', '/content-items/501/translate-async'),
        status: 404,
        body: { error: 'Not found' },
      },
      {
        match: pathMatcher('POST', '/content-items/501/translate'),
        status: 201,
        body: {
          data: {
            id: 611,
            title: 'Здравей свят',
            type: 'article',
            status: 'draft',
            language: 'bg',
          },
        },
      },
    ]);

    const result = await callTool(
      'translate_content_item',
      { content_item_id: 501, target_language: 'bg' },
      session
    );

    expect(String(calls[0]?.url)).toContain('/content-items/501/translate-async');
    expect(String(calls[1]?.url)).toContain('/api/v2/content-items/501/translate');
    expect(String(calls[1]?.url)).not.toContain('translate-async');
    expect(jsonBodyOf(calls[1])).toEqual({ target_language: 'bg' });
    const text = textOf(result);
    expect(text).toContain('Translation created');
    expect(text).toContain('611');
  });

  it('also falls back when the gateway answers 405 (method not allowed)', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('POST', '/content-items/501/translate-async'),
        status: 405,
        body: { error: 'Method not allowed' },
      },
      {
        match: pathMatcher('POST', '/content-items/501/translate'),
        status: 201,
        body: { data: { id: 612, title: 'x', type: 'article', status: 'draft', language: 'bg' } },
      },
    ]);

    const result = await callTool(
      'translate_content_item',
      { content_item_id: 501, target_language: 'bg' },
      session
    );

    expect(String(calls[1]?.url)).toContain('/content-items/501/translate');
    expect(textOf(result)).toContain('612');
  });
});
