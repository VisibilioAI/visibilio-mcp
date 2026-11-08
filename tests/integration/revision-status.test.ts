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

describe('get_revision_status — a landed revision is ready for review', () => {
  it('reports ready for review once the job completed and the item moved to review', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('GET', '/generation-jobs/901'),
        body: {
          data: {
            job_id: 901,
            kind: 'revision',
            status: 'completed',
            idempotency_key: 'org:7:item:501:revision:version:3',
            error: null,
          },
        },
      },
      {
        match: pathMatcher('GET', '/content-items/501'),
        body: { data: { id: 501, status: 'review', version: 4 } },
      },
    ]);

    const result = await callTool(
      'get_revision_status',
      { job_id: 901, content_item_id: 501 },
      session
    );

    expect(calls).toHaveLength(2);
    expect(String(calls[1]?.url)).toContain('/api/v2/content-items/501');
    const text = textOf(result);
    expect(text).toMatch(/ready for review/i);
    expect(text).toContain('review');
    expect(text).toContain('4');
  });
});

describe('get_revision_status — REV-08 guard: completed but not landed keeps polling', () => {
  it('does not claim ready when the job says completed but the item has not moved yet', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('GET', '/generation-jobs/902'),
        body: {
          data: {
            job_id: 902,
            kind: 'revision',
            status: 'completed',
            idempotency_key: 'org:7:item:501:revision:version:3',
            error: null,
          },
        },
      },
      {
        match: pathMatcher('GET', '/content-items/501'),
        body: { data: { id: 501, status: 'changes_requested', version: 3 } },
      },
    ]);

    const result = await callTool(
      'get_revision_status',
      { job_id: 902, content_item_id: 501 },
      session
    );

    expect(calls).toHaveLength(2);
    const text = textOf(result);
    expect(text).not.toMatch(/ready for review/i);
    expect(text).toMatch(/not landed yet/i);
    expect(text).toContain('get_revision_status');
  });
});

describe('get_revision_status — a version that moved past the baseline counts as landed', () => {
  it('reports ready even when the item advanced past review, because the version moved', async () => {
    const { session } = buildSession([
      {
        match: pathMatcher('GET', '/generation-jobs/903'),
        body: {
          data: {
            job_id: 903,
            kind: 'revision',
            status: 'completed',
            idempotency_key: 'org:7:item:501:revision:version:3',
            error: null,
          },
        },
      },
      {
        match: pathMatcher('GET', '/content-items/501'),
        body: { data: { id: 501, status: 'approved', version: 5 } },
      },
    ]);

    const result = await callTool(
      'get_revision_status',
      { job_id: 903, content_item_id: 501 },
      session
    );

    const text = textOf(result);
    expect(text).toMatch(/ready for review/i);
    expect(text).not.toMatch(/not landed yet/i);
    expect(text).toContain('5');
  });
});
