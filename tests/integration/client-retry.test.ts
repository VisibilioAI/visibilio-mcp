import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildSession, pathMatcher } from './_helpers.js';
import { allTools } from '../../src/tools/index.js';

function findTool(name: string) {
  const tool = allTools.find((t) => t.name === name);
  if (!tool) throw new Error(`tool ${name} not registered`);
  return tool;
}

describe('VisibilioClient retry behavior', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries 429 honoring Retry-After header (in seconds)', async () => {
    const path = pathMatcher('GET', '/api/v2/organizations/7/projects');
    const { session, fetch } = buildSession([
      {
        match: path,
        status: 429,
        body: { error: 'rate limited' },
        headers: { 'Retry-After': '1' },
      },
      { match: path, body: { data: { projects: [{ id: 'p1', name: 'Alpha' }] } } },
    ]);
    const promise = findTool('list_projects').handler({}, session);
    await vi.runAllTimersAsync();
    const text = await promise;
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(text).toContain('Alpha');
  });

  it('retries 503 with longer initial delay (knowledge breaker)', async () => {
    const path = pathMatcher('GET', '/api/v2/knowledge/7/company_profile');
    const { session, fetch } = buildSession([
      { match: path, status: 503, body: { error: 'circuit open' } },
      { match: path, body: { content: { name: 'Acme' } } },
    ]);
    const promise = findTool('get_knowledge').handler({ domain: 'company_profile' }, session);
    await vi.runAllTimersAsync();
    const text = await promise;
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(text).toContain('Acme');
  });

  it('retries 502 and 504 with exponential backoff', async () => {
    const path = pathMatcher('GET', '/api/v2/organizations/7/projects');
    const { session, fetch } = buildSession([
      { match: path, status: 502, body: {} },
      { match: path, status: 504, body: {} },
      { match: path, body: { data: { projects: [] } } },
    ]);
    const promise = findTool('list_projects').handler({}, session);
    await vi.runAllTimersAsync();
    const text = await promise;
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(text).toMatch(/No projects/);
  });

  it('does NOT retry 4xx (other than 429)', async () => {
    const path = pathMatcher('GET', '/api/v2/organizations/7/projects/missing');
    const { session, fetch } = buildSession([
      { match: path, status: 404, body: { error: 'not found' } },
    ]);
    const text = await findTool('get_project').handler({ project_id: 'missing' }, session);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(text).toMatch(/Could not find/);
  });

  it('gives up after 3 retry attempts and surfaces final error', async () => {
    const path = pathMatcher('GET', '/api/v2/organizations/7/projects');
    const { session, fetch } = buildSession([
      { match: path, status: 429, body: { error: 'r' } },
      { match: path, status: 429, body: { error: 'r' } },
      { match: path, status: 429, body: { error: 'r' } },
      { match: path, status: 429, body: { error: 'r' } },
    ]);
    const promise = findTool('list_projects').handler({}, session);
    await vi.runAllTimersAsync();
    const text = await promise;
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(text).toMatch(/Error listing projects/);
    expect(text).toContain('429');
  });

  it('succeeds on first try without consulting timer', async () => {
    const path = pathMatcher('GET', '/api/v2/organizations/7/projects');
    const { session, fetch } = buildSession([
      { match: path, body: { data: { projects: [{ id: 'p1', name: 'Alpha' }] } } },
    ]);
    const text = await findTool('list_projects').handler({}, session);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(text).toContain('Alpha');
  });
});
