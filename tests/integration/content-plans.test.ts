import { describe, it, expect } from 'vitest';
import { allTools } from '../../src/tools/index.js';
import { buildSession, pathMatcher } from './_helpers.js';

function findTool(name: string) {
  const tool = allTools.find((t) => t.name === name);
  if (!tool) throw new Error(`tool ${name} not registered`);
  return tool;
}

describe('list_content_plans', () => {
  it('returns no-active-project message when project unset', async () => {
    const { session, fetch } = buildSession([]);
    const text = await findTool('list_content_plans').handler({}, session);
    expect(text).toMatch(/No active project/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('formats plans list when project is active', async () => {
    const { session } = buildSession([
      {
        match: pathMatcher('GET', '/api/v2/organizations/7/projects/p1/content-plans'),
        body: { data: { content_plans: [{ id: 'cp1', name: 'Q1 Plan' }] } },
      },
    ]);
    session.setActiveProject('p1');
    const text = await findTool('list_content_plans').handler({}, session);
    expect(text).toContain('Content Plans:');
    expect(text).toContain('Q1 Plan');
    expect(text).toContain('cp1');
  });
});

describe('create_content_plan', () => {
  it('creates plan and returns confirmation', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('POST', '/api/v2/organizations/7/projects/p1/content-plans'),
        body: { data: { id: 'cp99', name: 'New Plan' } },
      },
    ]);
    session.setActiveProject('p1');
    const text = await findTool('create_content_plan').handler(
      {
        name: 'New Plan',
        description: 'Test',
        user_input: 'Focus on AI',
        audience_ids: ['a1', 'a2'],
      },
      session
    );
    expect(text).toContain('Content plan created: New Plan');
    expect(text).toContain('cp99');
    expect(calls[0]?.init?.body).toContain('"audience_ids":["a1","a2"]');
    expect(calls[0]?.init?.body).toContain('"user_input":"Focus on AI"');
  });

  it('refuses without active project', async () => {
    const { session, fetch } = buildSession([]);
    const text = await findTool('create_content_plan').handler({ name: 'X' }, session);
    expect(text).toMatch(/No active project/);
    expect(fetch).not.toHaveBeenCalled();
  });
});
