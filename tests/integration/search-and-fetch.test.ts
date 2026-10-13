import { describe, it, expect } from 'vitest';
import { buildSession, findTool, pathMatcher } from './_helpers.js';
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
    ]);

    const result = await (await findTool('search')).handler({ query: 'launch' }, session);

    expect(calls[1]!.url).toContain('search=launch');
    expect(calls[2]!.url).toContain('search=launch');
    expect(structuredOf(result)).toEqual({
      results: [
        { id: 'content-item:5', title: 'Launch plan', url: 'https://app.visibilio.ai/7/content/5' },
        { id: 'content-item:9', title: 'Launch post', url: 'https://app.visibilio.ai/7/content/9' },
      ],
    });
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

  it('rejects an id that is not a content item reference', async () => {
    const { session, fetch } = buildSession([]);

    const result = await (await findTool('fetch')).handler({ id: 'brief:3' }, session);

    expect(result).toMatch(/content-item:<id>/);
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
