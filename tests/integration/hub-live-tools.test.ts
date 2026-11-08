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

describe('unpublish_from_hub', () => {
  it('removes the article and reports the landed status', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('POST', '/api/v2/content-hubs/5/unpublish/501'),
        body: { data: { message: 'Article unpublished successfully' } },
      },
    ]);

    const text = await (
      await findTool('unpublish_from_hub')
    ).handler({ hub_id: 5, content_item_id: 501, target_status: 'archived' }, session);

    expect(jsonBodyOf(calls[0])).toEqual({ target_status: 'archived' });
    expect(text).toContain('Article unpublished successfully');
    expect(text).toContain('archived');
  });

  it('defaults the item to draft, unblocking a later delete (04 DEL-02)', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('POST', '/api/v2/content-hubs/5/unpublish/501'),
        body: { data: { message: 'Article unpublished successfully' } },
      },
    ]);

    const text = await (
      await findTool('unpublish_from_hub')
    ).handler({ hub_id: 5, content_item_id: 501 }, session);

    expect(jsonBodyOf(calls[0])).toEqual({});
    expect(text).toContain('draft');
  });
});
