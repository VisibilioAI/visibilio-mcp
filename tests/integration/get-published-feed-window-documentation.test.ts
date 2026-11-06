import { describe, it, expect } from 'vitest';
import { allTools } from '../../src/tools/index.js';

function toFieldDescription(): string | undefined {
  const tool = allTools.find((candidate) => candidate.name === 'get_published_feed');
  if (!tool) throw new Error('get_published_feed is not registered');
  return tool.inputSchema.to?.description;
}

describe('get_published_feed window documentation', () => {
  it('documents that the "to" bound is exclusive of the to date', () => {
    const description = toFieldDescription();
    expect(description).toBeTypeOf('string');
    expect(description!.toLowerCase()).toContain('exclusive');
  });

  it('tells callers to pass the next day to include a given day', () => {
    const description = toFieldDescription();
    expect(description).toBeTypeOf('string');
    expect(description!.toLowerCase()).toMatch(/next day/);
  });
});
