import { describe, it, expect } from 'vitest';
import { buildSession, callTool, pathMatcher, textOf } from './_helpers.js';

/**
 * request_content_changes starts a revision job. The caller must be able to find the tool
 * that follows it, exactly as repurpose_content_item and generate_cover_image name
 * get_generation_job_status. The returned text names get_revision_status.
 */

describe('request_content_changes — points the caller at get_revision_status', () => {
  it('names get_revision_status and the job id in its reply', async () => {
    const { session } = buildSession([
      {
        match: pathMatcher('POST', '/content-items/501/request-changes'),
        status: 202,
        body: { data: { job_id: 900, status: 'changes_requested' } },
      },
    ]);

    const result = await callTool(
      'request_content_changes',
      { content_item_id: 501, reason: 'wrong_tone', note: 'Soften the opening paragraph.' },
      session
    );

    const text = textOf(result);
    expect(text).toContain('900');
    expect(text).toContain('get_revision_status');
  });
});
