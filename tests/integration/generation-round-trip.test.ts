import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildSession, findTool, jsonBodyOf, pathMatcher } from './_helpers.js';

const STATUS = pathMatcher('GET', '/api/v2/workflow/544/status');
const CREATE = pathMatcher('POST', '/api/v2/products/147/content-items');

const ARTICLE = {
  title: 'Geely Starray EM-i',
  body: '<p>Plug-in hybrid under 30 000 EUR.</p>',
  full_content: '<p>Plug-in hybrid under 30 000 EUR.</p>',
  body_format: 'html',
  platform: 'blog',
  word_count: 812,
  excerpt: 'What 29 990 EUR buys.',
  subtitle: 'The first Geely PHEV in Bulgaria',
  seo_meta: { description: 'Geely Starray EM-i review', keywords: ['geely'] },
  aeo_assets: {
    faqs: [{ question: 'What does it cost?', answer: 'From 29 990 EUR.' }],
    summary_bullets: ['Plug-in hybrid', '83 km electric range'],
    sources: [{ url: 'https://example.com/review', title: 'Review', publisher: 'example.com' }],
  },
};

const LINKEDIN_POST = {
  title: 'Geely teaser',
  body: '83 km on electricity. Which number is yours?',
  body_format: 'plain',
  platform: 'linkedin',
  aeo_assets: null,
};

const run = (state: string, pieces: unknown[] = []) => ({
  execution_id: '544',
  state,
  is_complete: !['processing', 'planning', 'running'].includes(state),
  final_output:
    state === 'completed'
      ? {
          steps: {
            content_1: {
              output: {
                content_pieces: pieces,
                search_metadata: { queries: ['geely starray price'] },
              },
            },
          },
          steps_completed: 1,
        }
      : null,
});

const CREATED = {
  data: { id: 900, type: 'article', title: 'Geely Starray EM-i', status: 'draft' },
};

describe('generation round trip — waiting for a run', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('get_workflow_status waits on a running run and answers as soon as it completes', async () => {
    const { session, calls } = buildSession([
      { match: STATUS, body: run('running') },
      { match: STATUS, body: run('running') },
      { match: STATUS, body: run('completed', [ARTICLE]) },
    ]);

    const pending = (await findTool('get_workflow_status')).handler(
      { execution_id: '544' },
      session
    );
    await vi.runAllTimersAsync();
    const text = await pending;

    expect(calls).toHaveLength(3);
    expect(text).toContain('completed');
    expect(text).toContain('Geely Starray EM-i');
  });

  it('get_workflow_status hands a still-running run back within 40 seconds', async () => {
    const { session, calls } = buildSession([{ match: STATUS, body: run('running') }]);
    const startedAt = Date.now();

    const pending = (await findTool('get_workflow_status')).handler(
      { execution_id: '544' },
      session
    );
    await vi.runAllTimersAsync();
    const text = await pending;

    const waited = Date.now() - startedAt;
    expect(waited).toBeGreaterThan(30_000);
    expect(waited).toBeLessThanOrEqual(40_000);
    expect(calls.length).toBeGreaterThan(1);
    expect(text).toMatch(/still running/i);
  });
});

describe('generation round trip — reading a finished run', () => {
  it('get_workflow_status shows each piece with its text and asset counts, not the raw research payload', async () => {
    const { session } = buildSession([{ match: STATUS, body: run('completed', [ARTICLE]) }]);

    const text = await (
      await findTool('get_workflow_status')
    ).handler({ execution_id: '544' }, session);

    expect(text).toContain('Geely Starray EM-i');
    expect(text).toContain('<p>Plug-in hybrid under 30 000 EUR.</p>');
    expect(text).toContain('FAQ: 1');
    expect(text).toContain('summary bullets: 2');
    expect(text).toContain('sources: 1');
    expect(text).not.toContain('https://example.com/review');
    expect(text).not.toContain('geely starray price');
  });
});

describe('generation round trip — saving a run', () => {
  it('create_content_item with only the execution id stores the generated title, text, SEO and answer-engine fields', async () => {
    const { session, calls } = buildSession([
      { match: STATUS, body: run('completed', [ARTICLE]) },
      { match: CREATE, status: 201, body: CREATED },
    ]);
    await session.setActiveProduct(147, 'Visibilio');

    await (
      await findTool('create_content_item')
    ).handler({ type: 'article', source_execution_id: '544' }, session);

    expect(jsonBodyOf(calls[1])).toEqual({
      type: 'article',
      source_execution_id: '544',
      title: ARTICLE.title,
      body: ARTICLE.body,
      body_format: 'html',
      platform: 'blog',
      excerpt: ARTICLE.excerpt,
      subtitle: ARTICLE.subtitle,
      seo_meta: ARTICLE.seo_meta,
      aeo_assets: ARTICLE.aeo_assets,
    });
  });

  it('create_content_item keeps what the model passed over the generated values', async () => {
    const { session, calls } = buildSession([
      { match: STATUS, body: run('completed', [ARTICLE]) },
      { match: CREATE, status: 201, body: CREATED },
    ]);
    await session.setActiveProduct(147, 'Visibilio');

    await (
      await findTool('create_content_item')
    ).handler(
      {
        type: 'article',
        source_execution_id: '544',
        title: 'Edited title',
        body: '<p>Edited</p>',
      },
      session
    );

    expect(jsonBodyOf(calls[1])).toMatchObject({
      title: 'Edited title',
      body: '<p>Edited</p>',
      excerpt: ARTICLE.excerpt,
      aeo_assets: ARTICLE.aeo_assets,
    });
  });

  it('create_content_item picks the piece by platform when a run produced several', async () => {
    const { session, calls } = buildSession([
      { match: STATUS, body: run('completed', [LINKEDIN_POST, ARTICLE]) },
      { match: CREATE, status: 201, body: CREATED },
    ]);
    await session.setActiveProduct(147, 'Visibilio');

    await (
      await findTool('create_content_item')
    ).handler({ type: 'social_post', platform: 'linkedin', source_execution_id: '544' }, session);

    expect(jsonBodyOf(calls[1])).toMatchObject({
      title: LINKEDIN_POST.title,
      body: LINKEDIN_POST.body,
      platform: 'linkedin',
    });
  });

  it('create_content_item asks which piece to save when several match and nothing tells them apart', async () => {
    const { session, calls } = buildSession([
      { match: STATUS, body: run('completed', [LINKEDIN_POST, ARTICLE]) },
    ]);
    await session.setActiveProduct(147, 'Visibilio');

    const text = await (
      await findTool('create_content_item')
    ).handler({ type: 'article', source_execution_id: '544' }, session);

    expect(calls).toHaveLength(1);
    expect(text).toContain('2 pieces');
    expect(text).toMatch(/title|platform/);
  });
});
