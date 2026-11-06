import { describe, it, expect } from 'vitest';
import { buildSession, callTool, findTool, pathMatcher, textOf } from './_helpers.js';
import { toCallToolResult } from '../../src/tools/_define.js';

const PRODUCTS = {
  match: pathMatcher('GET', '/api/v2/products'),
  body: {
    data: [
      { id: 147, name: 'Visibilio' },
      { id: 148, name: 'Kondevs' },
    ],
    total: 2,
  },
};

function structuredOf(result: unknown): Record<string, unknown> {
  expect(result).toMatchObject({ structuredContent: expect.any(Object) });
  return (result as { structuredContent: Record<string, unknown> }).structuredContent;
}

describe('search (ChatGPT connector contract)', () => {
  it('searches the content items of every product in the active organization and returns {results:[{id,title,url}]}', async () => {
    const { session, calls } = buildSession([
      PRODUCTS,
      {
        match: pathMatcher('GET', '/api/v2/products/147/content-items'),
        body: { data: [{ id: 5, title: 'Launch plan', type: 'article', status: 'draft' }] },
      },
      {
        match: pathMatcher('GET', '/api/v2/products/148/content-items'),
        body: { data: [{ id: 9, title: 'Launch post', type: 'social_post', status: 'published' }] },
      },
      {
        match: pathMatcher('GET', '/api/v2/organizations/7/published-feed'),
        body: { data: [{ content_item_id: 9, live_url: 'https://site.com/launch-post' }] },
      },
    ]);

    const result = await (await findTool('search')).handler({ query: 'launch' }, session);

    expect(calls[1]!.url).toContain('search=launch');
    expect(calls[2]!.url).toContain('search=launch');
    // RED driver: item 9 is published, so its url must be the mapped live_url, not the app page.
    expect(structuredOf(result)).toEqual({
      results: [
        { id: 'content-item:5', title: 'Launch plan', url: 'https://app.visibilio.ai/7/content/5' },
        { id: 'content-item:9', title: 'Launch post', url: 'https://site.com/launch-post' },
      ],
    });
    // Regression guard — already passes; product 147 has no published item, so no feed
    // lookup for it should ever happen.
    expect(
      calls.some((c) => c.url.includes('published-feed') && c.url.includes('product_id=147'))
    ).toBe(false);
  });

  it('an empty query returns no results and never calls the gateway', async () => {
    const { session, fetch } = buildSession([]);

    const result = await (await findTool('search')).handler({ query: '   ' }, session);

    expect(structuredOf(result)).toEqual({ results: [] });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('fetch (ChatGPT connector contract)', () => {
  it('returns the content item as {id,title,text,url,metadata} with the HTML body turned into text', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('GET', '/api/v2/content-items/5'),
        body: {
          data: {
            id: 5,
            product_id: 147,
            title: 'Launch plan',
            type: 'article',
            status: 'draft',
            platform: 'blog',
            language: 'en',
            body: '<h2>Why now</h2><p>Q4 &amp; beyond.</p><p>Second&nbsp;paragraph.</p>',
          },
        },
      },
    ]);

    const result = await (await findTool('fetch')).handler({ id: 'content-item:5' }, session);

    expect(calls[0]!.url).toContain('/api/v2/content-items/5');
    expect(structuredOf(result)).toEqual({
      id: 'content-item:5',
      title: 'Launch plan',
      text: 'Why now\nQ4 & beyond.\nSecond paragraph.',
      url: 'https://app.visibilio.ai/7/content/5',
      metadata: {
        type: 'article',
        status: 'draft',
        platform: 'blog',
        language: 'en',
        product_id: 147,
      },
    });
  });

  it('returns the published live_url for a published article that has one', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('GET', '/api/v2/content-items/5'),
        body: {
          data: {
            id: 5,
            product_id: 147,
            title: 'Launch',
            type: 'article',
            status: 'published',
            body: '<p>Hi</p>',
          },
        },
      },
      {
        match: pathMatcher('GET', '/api/v2/organizations/7/published-feed'),
        body: { data: [{ content_item_id: 5, live_url: 'https://site.com/launch' }] },
      },
    ]);

    const result = await (await findTool('fetch')).handler({ id: 'content-item:5' }, session);

    expect(structuredOf(result).url).toBe('https://site.com/launch');
    expect(calls[1]!.url).toContain('product_id=147');
  });

  // Regression guard — already passes; locks in current fallback behavior so future
  // weakening of the empty-feed-row path cannot regress.
  it('falls back to the app page when a published article has no feed entry', async () => {
    const { session } = buildSession([
      {
        match: pathMatcher('GET', '/api/v2/content-items/5'),
        body: {
          data: {
            id: 5,
            product_id: 147,
            title: 'Launch',
            type: 'article',
            status: 'published',
            body: '<p>Hi</p>',
          },
        },
      },
      {
        match: pathMatcher('GET', '/api/v2/organizations/7/published-feed'),
        body: { data: [] },
      },
    ]);

    const result = await (await findTool('fetch')).handler({ id: 'content-item:5' }, session);

    expect(structuredOf(result).url).toBe('https://app.visibilio.ai/7/content/5');
  });

  // Regression guard — already passes; locks in that a draft never triggers the new
  // published-feed lookup so future weakening of the status gate cannot regress.
  it('returns the app page for a non-published item and never calls the published feed', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('GET', '/api/v2/content-items/5'),
        body: {
          data: {
            id: 5,
            product_id: 147,
            title: 'Launch',
            type: 'article',
            status: 'draft',
            body: '<p>Hi</p>',
          },
        },
      },
    ]);

    const result = await (await findTool('fetch')).handler({ id: 'content-item:5' }, session);

    expect(structuredOf(result).url).toBe('https://app.visibilio.ai/7/content/5');
    expect(calls.some((c) => c.url.includes('published-feed'))).toBe(false);
  });

  it('fails for an id that is not a content item reference', async () => {
    const { session, fetch } = buildSession([]);

    const result = await callTool('fetch', { id: 'brief:3' }, session);

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(
      'Error: Unknown id "brief:3". Expected content-item:<id> as returned by search.'
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('toCallToolResult', () => {
  it('wraps a string as one text content item', () => {
    expect(toCallToolResult('Products:\n- A')).toEqual({
      content: [{ type: 'text', text: 'Products:\n- A' }],
    });
  });

  it('wraps a structured result as structuredContent plus the same JSON as text', () => {
    const structuredContent = {
      results: [{ id: 'content-item:5', title: 'A', url: 'https://x/5' }],
    };

    expect(toCallToolResult({ structuredContent })).toEqual({
      content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
      structuredContent,
    });
  });
});
