import { describe, it, expect } from 'vitest';
import { buildSession, callTool, pathMatcher, textOf } from './_helpers.js';

/**
 * Following a revision job. request_content_changes starts a revision job and returns a
 * job id, but there was no way to follow it. get_revision_status reads the shared
 * generation-jobs status AND the content item, and only reports the revision ready for
 * review once the job is completed and the item has actually moved (status review, or its
 * version advanced past the revision baseline). While the job says completed but the item
 * has not moved yet — the callback race — it keeps the caller polling instead of claiming
 * success (the REV-08 guard).
 */

describe('get_revision_status — a running job keeps the caller polling', () => {
  it('reports a running revision job and tells the caller to call again', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('GET', '/generation-jobs/900'),
        body: {
          data: {
            job_id: 900,
            kind: 'revision',
            status: 'running',
            idempotency_key: 'org:7:item:501:revision:version:3',
            error: null,
          },
        },
      },
    ]);

    const result = await callTool(
      'get_revision_status',
      { job_id: 900, content_item_id: 501 },
      session
    );

    expect(String(calls[0]?.url)).toContain('/api/v2/generation-jobs/900');
    expect(calls).toHaveLength(1);
    const text = textOf(result);
    expect(text).toMatch(/running/i);
    expect(text).toContain('get_revision_status');
  });
});
