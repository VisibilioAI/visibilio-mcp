import { describe, it, expect } from 'vitest';
import { allTools } from '../../src/tools/index.js';
import { buildSession, pathMatcher } from './_helpers.js';

function findTool(name: string) {
  const tool = allTools.find((t) => t.name === name);
  if (!tool) throw new Error(`tool ${name} not registered`);
  return tool;
}

describe('list_projects', () => {
  it('returns formatted list when gateway returns projects array under data.projects', async () => {
    const { session } = buildSession([
      {
        match: pathMatcher('GET', '/api/v2/organizations/7/projects'),
        body: {
          data: {
            projects: [
              { id: 'p1', name: 'Alpha' },
              { id: 'p2', name: 'Beta' },
            ],
          },
        },
      },
    ]);
    const text = await findTool('list_projects').handler({}, session);
    expect(text).toContain('Projects:');
    expect(text).toContain('Alpha');
    expect(text).toContain('Beta');
    expect(text).toContain('p1');
  });

  it('returns no-projects message on empty list', async () => {
    const { session } = buildSession([
      {
        match: pathMatcher('GET', '/api/v2/organizations/7/projects'),
        body: { data: { projects: [] } },
      },
    ]);
    const text = await findTool('list_projects').handler({}, session);
    expect(text).toMatch(/No projects/i);
  });

  it('returns formatted error on 500', async () => {
    const { session } = buildSession([
      {
        match: pathMatcher('GET', '/api/v2/organizations/7/projects'),
        status: 500,
        body: { error: 'boom' },
      },
    ]);
    const text = await findTool('list_projects').handler({}, session);
    expect(text).toMatch(/Error listing projects/);
    expect(text).toContain('500');
    expect(text).toContain('boom');
  });
});

describe('get_project', () => {
  it('formats single-project response', async () => {
    const { session } = buildSession([
      {
        match: pathMatcher('GET', '/api/v2/organizations/7/projects/p1'),
        body: { data: { id: 'p1', name: 'Alpha', status: 'active' } },
      },
    ]);
    const text = await findTool('get_project').handler({ project_id: 'p1' }, session);
    expect(text).toContain('Project: Alpha');
    expect(text).toContain('ID: p1');
    expect(text).toContain('Status: active');
  });

  it('returns not-found message on 404', async () => {
    const { session } = buildSession([
      {
        match: pathMatcher('GET', '/api/v2/organizations/7/projects/missing'),
        status: 404,
        body: {},
      },
    ]);
    const text = await findTool('get_project').handler({ project_id: 'missing' }, session);
    expect(text).toMatch(/Could not find project missing/);
  });
});

describe('set_active_project', () => {
  it('mutates session.projectId and confirms', async () => {
    const { session } = buildSession([
      {
        match: pathMatcher('GET', '/api/v2/organizations/7/projects/p1'),
        body: { data: { id: 'p1', name: 'Alpha' } },
      },
    ]);
    expect(session.projectId).toBeNull();
    const text = await findTool('set_active_project').handler({ project_id: 'p1' }, session);
    expect(session.projectId).toBe('p1');
    expect(text).toContain('Active project set: Alpha');
  });
});
