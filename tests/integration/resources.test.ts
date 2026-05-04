import { describe, it, expect } from 'vitest';
import { allResources } from '../../src/resources/index.js';
import { buildSession, pathMatcher } from './_helpers.js';

function findResource(name: string) {
  const r = allResources.find((x) => x.name === name);
  if (!r) throw new Error(`resource ${name} not registered`);
  return r;
}

describe('current_organization', () => {
  it('returns auth-derived facts without making any HTTP call', async () => {
    const { session, fetch } = buildSession([]);
    const result = await findResource('current_organization').read(session);
    expect(result.text).toContain('Organization ID: 7');
    expect(result.text).toContain('User ID: 42');
    expect(result.text).toContain('Subscription Tier: pro');
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('current_project', () => {
  it('says no-active-project when none set', async () => {
    const { session, fetch } = buildSession([]);
    const result = await findResource('current_project').read(session);
    expect(result.text).toMatch(/No active project/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fetches project details when one is active', async () => {
    const { session } = buildSession([
      {
        match: pathMatcher('GET', '/api/v2/organizations/7/projects/p1'),
        body: { data: { id: 'p1', name: 'Alpha', status: 'active' } },
      },
    ]);
    session.setActiveProject('p1');
    const result = await findResource('current_project').read(session);
    expect(result.text).toContain('Project: Alpha');
    expect(result.text).toContain('ID: p1');
  });
});

describe('company_profile resource', () => {
  it('reads from knowledge backend', async () => {
    const { session } = buildSession([
      {
        match: pathMatcher('GET', '/api/v2/knowledge/7/company_profile'),
        body: { content: { name: 'Acme', website: 'acme.test' } },
      },
    ]);
    const result = await findResource('company_profile').read(session);
    expect(result.text).toContain('Acme');
    expect(result.text).toContain('acme.test');
    expect(result.uri).toBe('visibilio://company_profile');
  });

  it('returns onboarding hint when content is null', async () => {
    const { session } = buildSession([
      { match: pathMatcher('GET', '/api/v2/knowledge/7/company_profile'), body: { content: null } },
    ]);
    const result = await findResource('company_profile').read(session);
    expect(result.text).toMatch(/No company profile data available/);
  });
});

describe('scoring_profile resource', () => {
  it('reads from knowledge backend', async () => {
    const { session } = buildSession([
      {
        match: pathMatcher('GET', '/api/v2/knowledge/7/scoring_profile'),
        body: { content: { weights: { brand_fit: 0.4, audience_fit: 0.6 } } },
      },
    ]);
    const result = await findResource('scoring_profile').read(session);
    expect(result.text).toContain('brand_fit');
    expect(result.text).toContain('audience_fit');
  });
});
