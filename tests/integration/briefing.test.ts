import { describe, it, expect } from 'vitest';
import { allTools } from '../../src/tools/index.js';
import { buildSession, pathMatcher } from './_helpers.js';

function findTool(name: string) {
  const tool = allTools.find((t) => t.name === name);
  if (!tool) throw new Error(`tool ${name} not registered`);
  return tool;
}

describe('get_briefing', () => {
  it('formats executive overview + key developments', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('POST', '/api/v2/intelligence/briefing/generate'),
        body: {
          executive_overview: 'AI infra investment is consolidating around 3 hyperscalers.',
          key_developments: [
            {
              title: 'OpenAI raises $40B',
              source_name: 'TechCrunch',
              url: 'https://example.com/openai',
              relevance_score: 0.95,
              summary: 'Series K funding from SoftBank.',
            },
            {
              title: 'Google launches Gemini 3',
              source_name: 'The Verge',
            },
          ],
        },
      },
    ]);
    const text = await findTool('get_briefing').handler({}, session);
    expect(text).toContain('Executive Overview:');
    expect(text).toContain('hyperscalers');
    expect(text).toContain('Key Developments:');
    expect(text).toContain('OpenAI raises $40B');
    expect(text).toContain('Series K funding');
    expect(text).toContain('TechCrunch');
    expect(calls[0]?.init?.body).toContain('"signals":[]');
  });

  it('returns no-briefing message when backend returns null', async () => {
    const { session } = buildSession([
      { match: pathMatcher('POST', '/api/v2/intelligence/briefing/generate'), body: null },
    ]);
    const text = await findTool('get_briefing').handler({}, session);
    expect(text).toMatch(/No briefing available/);
  });
});
