import { describe, it, expect } from 'vitest';
import { buildSession, findTool, jsonBodyOf, pathMatcher } from './_helpers.js';

describe('update_hub_publication', () => {
  it('pushes the update to the hub and reports status and live url', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('POST', '/api/v2/content-hubs/5/update/501'),
        body: {
          data: {
            id: 9,
            status: 'committed',
            live_url: 'https://site.test/post',
            file_path: 'content/articles/x.md',
          },
        },
      },
    ]);

    const text = await (
      await findTool('update_hub_publication')
    ).handler({ hub_id: 5, content_item_id: 501, slug: 'x' }, session);

    expect(jsonBodyOf(calls[0])).toEqual({ slug: 'x' });
    expect(text).toContain('status: committed');
    expect(text).toContain('live_url: https://site.test/post');
    expect(text).toContain('publication_id: 9');
  });

  it('sends an empty body when no slug is given', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('POST', '/api/v2/content-hubs/5/update/501'),
        body: { data: { id: 9, status: 'committed' } },
      },
    ]);

    await (
      await findTool('update_hub_publication')
    ).handler({ hub_id: 5, content_item_id: 501 }, session);

    expect(jsonBodyOf(calls[0])).toEqual({});
  });
});
