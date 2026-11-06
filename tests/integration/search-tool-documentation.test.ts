import { describe, it, expect } from 'vitest';
import { allTools } from '../../src/tools/index.js';
import { MAX_RESULTS, RESULTS_PER_PRODUCT } from '../../src/tools/search.js';

function searchDescription(): string {
  const tool = allTools.find((candidate) => candidate.name === 'search');
  if (!tool) throw new Error('search tool is not registered');
  return tool.description;
}

describe('search tool documentation', () => {
  it('documents the per-product result cap it enforces', () => {
    const description = searchDescription();
    expect(description).toContain(String(RESULTS_PER_PRODUCT));
    expect(description.toLowerCase()).toContain('per product');
  });

  it('documents the total result cap it enforces and that there is no paging', () => {
    const description = searchDescription();
    expect(description).toContain(String(MAX_RESULTS));
    expect(description.toLowerCase()).toContain('no paging');
  });

  it('tells callers the query is matched as-is so wildcards and quotes are unnecessary', () => {
    const description = searchDescription().toLowerCase();
    expect(description).toContain('as-is');
    expect(description).toMatch(/do not need|no need/);
  });
});
