import { describe, expect, it } from 'vitest';
import { buildSession, pathMatcher } from './_helpers.js';
import { allTools } from '../../src/tools/index.js';

function findTool(name: string) {
  const t = allTools.find((x) => x.name === name);
  if (!t) throw new Error(`tool ${name} not registered`);
  return t;
}

describe('McpSession active organization override', () => {
  it('organizationId returns auth.organizationId by default', () => {
    const { session } = buildSession([]);
    expect(session.organizationId).toBe(7);
  });

  it('setActiveOrganization changes the organizationId getter result', () => {
    const { session } = buildSession([]);
    session.setActiveOrganization(149, 'Verto Digital');
    expect(session.organizationId).toBe(149);
    expect(session.organizationName).toBe('Verto Digital');
  });

  it('buildTenantHeaders reflects the active organization', () => {
    const { session } = buildSession([]);
    session.setActiveOrganization(149, 'Verto Digital');
    const headers = session.buildTenantHeaders();
    expect(headers['X-Organization-Id']).toBe('149');
  });
});

describe('set_active_organization tool', () => {
  it('updates the active organization on the session and returns a confirmation', async () => {
    const { session } = buildSession([]);
    const out = await findTool('set_active_organization').handler(
      { organization_id: '149' },
      session
    );
    expect(out).toContain('149');
    expect(session.organizationId).toBe(149);
  });

  it('returns an error when organization_id is missing', async () => {
    const { session } = buildSession([]);
    const out = await findTool('set_active_organization').handler({}, session);
    expect(out.toLowerCase()).toContain('organization_id');
    expect(out.toLowerCase()).toContain('required');
    expect(session.organizationId).toBe(7);
  });

  it('rejects non-numeric organization_id', async () => {
    const { session } = buildSession([]);
    const out = await findTool('set_active_organization').handler(
      { organization_id: 'not-a-number' },
      session
    );
    expect(out.toLowerCase()).toContain('numeric');
    expect(session.organizationId).toBe(7);
  });

  it('subsequent backend calls use the new organization in tenant headers', async () => {
    const { session, fetch } = buildSession([
      {
        match: pathMatcher('GET', '/api/v2/knowledge/149/audience_data'),
        body: { content: { personas: [{ id: 'p1', name: 'Alpha' }] } },
      },
    ]);
    await findTool('set_active_organization').handler({ organization_id: '149' }, session);
    await findTool('list_audiences').handler({}, session);
    const fetchCall = fetch.mock.calls[0]!;
    const url = fetchCall[0] as string;
    const init = fetchCall[1] as RequestInit;
    expect(url).toContain('/api/v2/knowledge/149/audience_data');
    const headers = (init.headers ?? {}) as Record<string, string>;
    expect(headers['X-Organization-Id']).toBe('149');
  });
});
