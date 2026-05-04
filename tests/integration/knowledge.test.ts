import { describe, it, expect } from 'vitest';
import { allTools } from '../../src/tools/index.js';
import { buildSession, pathMatcher } from './_helpers.js';

function findTool(name: string) {
  const tool = allTools.find((t) => t.name === name);
  if (!tool) throw new Error(`tool ${name} not registered`);
  return tool;
}

describe('get_knowledge', () => {
  it('returns content for valid domain', async () => {
    const { session } = buildSession([
      {
        match: pathMatcher('GET', '/api/v2/knowledge/7/company_profile'),
        body: { content: { name: 'Acme', industry: 'SaaS' } },
      },
    ]);
    const text = await findTool('get_knowledge').handler({ domain: 'company_profile' }, session);
    expect(text).toContain('Acme');
    expect(text).toContain('SaaS');
  });

  it('returns no-data message on null content', async () => {
    const { session } = buildSession([
      { match: pathMatcher('GET', '/api/v2/knowledge/7/scoring_profile'), body: { content: null } },
    ]);
    const text = await findTool('get_knowledge').handler({ domain: 'scoring_profile' }, session);
    expect(text).toMatch(/No data found/);
  });

  it('rejects invalid domain without making request', async () => {
    const { session, fetch } = buildSession([]);
    const text = await findTool('get_knowledge').handler({ domain: 'not_a_domain' }, session);
    expect(text).toMatch(/Invalid domain/);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('list_audiences', () => {
  it('formats personas array under content.personas', async () => {
    const { session } = buildSession([
      {
        match: pathMatcher('GET', '/api/v2/knowledge/7/audience_data'),
        body: {
          content: {
            personas: [
              { id: 1, name: 'CTO', description: 'Tech buyer at growth-stage SaaS' },
              { id: 2, name: 'CMO' },
            ],
          },
        },
      },
    ]);
    const text = await findTool('list_audiences').handler({}, session);
    expect(text).toContain('Audience Personas:');
    expect(text).toContain('CTO');
    expect(text).toContain('CMO');
    expect(text).toContain('Tech buyer');
  });

  it('returns empty message on no personas', async () => {
    const { session } = buildSession([
      {
        match: pathMatcher('GET', '/api/v2/knowledge/7/audience_data'),
        body: { content: { personas: [] } },
      },
    ]);
    const text = await findTool('list_audiences').handler({}, session);
    expect(text).toMatch(/No audience personas/);
  });
});
