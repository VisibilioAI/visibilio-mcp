import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildSession, findTool, pathMatcher } from './_helpers.js';
import { HttpError } from '../../src/client.js';

const PRODUCTS = pathMatcher('GET', '/api/v2/products');

describe('VisibilioClient retry behavior', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries 429 honoring Retry-After header (in seconds)', async () => {
    const { session, fetch } = buildSession([
      {
        match: PRODUCTS,
        status: 429,
        body: { error: 'rate limited' },
        headers: { 'Retry-After': '1' },
      },
      { match: PRODUCTS, body: { products: [{ id: 1, name: 'Alpha' }] } },
    ]);
    const promise = session.client.get('/api/v2/products');
    await vi.runAllTimersAsync();
    expect(await promise).toEqual({ products: [{ id: 1, name: 'Alpha' }] });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('retries 503 with a longer initial delay', async () => {
    const { session, fetch } = buildSession([
      { match: PRODUCTS, status: 503, body: { error: 'circuit open' } },
      { match: PRODUCTS, body: { products: [] } },
    ]);
    const promise = session.client.get('/api/v2/products');
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.runAllTimersAsync();
    await promise;
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('retries 502 and 504 with exponential backoff', async () => {
    const { session, fetch } = buildSession([
      { match: PRODUCTS, status: 502, body: {} },
      { match: PRODUCTS, status: 504, body: {} },
      { match: PRODUCTS, body: { products: [] } },
    ]);
    const promise = session.client.get('/api/v2/products');
    await vi.runAllTimersAsync();
    expect(await promise).toEqual({ products: [] });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('does NOT retry 4xx (other than 429) and surfaces the status and body', async () => {
    const { session, fetch } = buildSession([
      {
        match: pathMatcher('GET', '/api/v2/products/999'),
        status: 404,
        body: { error: 'not found' },
      },
    ]);
    await expect(session.client.get('/api/v2/products/999')).rejects.toMatchObject({
      status: 404,
      body: { error: 'not found' },
    });
    await expect(session.client.get('/api/v2/products/999')).rejects.toBeInstanceOf(HttpError);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('gives up after 3 retry attempts; the tool reports the final status to the model', async () => {
    const { session, fetch } = buildSession([
      { match: PRODUCTS, status: 429, body: { error: 'r' } },
      { match: PRODUCTS, status: 429, body: { error: 'r' } },
      { match: PRODUCTS, status: 429, body: { error: 'r' } },
      { match: PRODUCTS, status: 429, body: { error: 'r' } },
    ]);
    const tool = await findTool('list_products');
    const promise = tool.handler({}, session);
    await vi.runAllTimersAsync();
    const text = await promise;
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(text).toMatch(/Error listing products/);
    expect(text).toContain('429');
  });

  it('succeeds on first try without consulting the timer', async () => {
    const { session, fetch } = buildSession([
      { match: PRODUCTS, body: { products: [{ id: 1, name: 'Alpha' }] } },
    ]);
    const tool = await findTool('list_products');
    const text = await tool.handler({}, session);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(text).toContain('Alpha');
    expect(text).toContain('product_id: 1');
  });
});
