import { describe, it, expect } from 'vitest';
import { allTools } from '../../src/tools/index.js';
import { allResources } from '../../src/resources/index.js';
import { buildSession, pathMatcher } from './_helpers.js';

function findTool(name: string) {
  const tool = allTools.find((t) => t.name === name);
  if (!tool) throw new Error(`tool ${name} not registered`);
  return tool;
}

function findResource(name: string) {
  const r = allResources.find((x) => x.name === name);
  if (!r) throw new Error(`resource ${name} not registered`);
  return r;
}

describe('cross-org isolation', () => {
  it('every backend request includes the session orgId in tenant headers', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('GET', '/api/v2/knowledge/7/company_profile'),
        body: { content: { name: 'Acme' } },
      },
    ]);
    await findTool('get_knowledge').handler({ domain: 'company_profile' }, session);
    const headers = (calls[0]?.init?.headers ?? {}) as Record<string, string>;
    expect(headers['X-Organization-Id']).toBe('7');
    expect(headers['X-User-Id']).toBe('42');
  });

  it('a session for org A cannot read org B project (RLS-like 404 from gateway)', async () => {
    const { session } = buildSession(
      [
        {
          match: pathMatcher('GET', '/api/v2/organizations/7/projects/foreign'),
          status: 404,
          body: { error: 'project not found' },
        },
      ],
      { organizationId: 7 }
    );
    const text = await findTool('set_active_project').handler({ project_id: 'foreign' }, session);
    expect(text).toMatch(/Could not find project foreign/);
    expect(session.projectId).toBeNull();
  });

  it('current_project URL is built from the session orgId only — clients cannot override it', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('GET', '/api/v2/organizations/7/projects/p1'),
        body: { data: { id: 'p1', name: 'Alpha' } },
      },
    ]);
    session.setActiveProject('p1');
    await findResource('current_project').read(session);
    expect(calls[0]?.url).toContain('/organizations/7/projects/p1');
    expect(calls[0]?.url).not.toContain('/organizations/8/');
  });
});
