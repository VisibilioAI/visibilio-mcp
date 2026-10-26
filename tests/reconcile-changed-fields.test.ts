import { describe, it, expect } from 'vitest';
import { reconcileChangedFields } from '../src/tools/publication-sync.js';

describe('reconcileChangedFields — report what actually changed, not only versioned fields', () => {
  it('reports a status transition the gateway did not version (#965.7)', () => {
    const result = reconcileChangedFields({
      before: { status: 'draft' },
      after: { status: 'review' },
      requested: ['status'],
      versionChangedFields: [],
    });
    expect(result).toEqual(['status']);
  });

  it('does not report status when the requested status equals the stored status', () => {
    const result = reconcileChangedFields({
      before: { status: 'published' },
      after: { status: 'published' },
      requested: ['status'],
      versionChangedFields: [],
    });
    expect(result).toEqual([]);
  });

  it('keeps the gateway versioned fields and adds the non-versioned change', () => {
    const result = reconcileChangedFields({
      before: { body: 'old', status: 'draft' },
      after: { body: 'new', status: 'review' },
      requested: ['body', 'status'],
      versionChangedFields: ['body'],
    });
    expect(result).toEqual(['body', 'status']);
  });

  it('detects an array field change by value, not by reference', () => {
    const result = reconcileChangedFields({
      before: { tags: ['a'] },
      after: { tags: ['a', 'b'] },
      requested: ['tags'],
      versionChangedFields: [],
    });
    expect(result).toEqual(['tags']);
  });

  it('detects an object field change ignoring key order', () => {
    const changed = reconcileChangedFields({
      before: { seo_meta: { description: 'x', keywords: ['k'] } },
      after: { seo_meta: { keywords: ['k'], description: 'y' } },
      requested: ['seo_meta'],
      versionChangedFields: [],
    });
    expect(changed).toEqual(['seo_meta']);

    const unchanged = reconcileChangedFields({
      before: { seo_meta: { description: 'x', keywords: ['k'] } },
      after: { seo_meta: { keywords: ['k'], description: 'x' } },
      requested: ['seo_meta'],
      versionChangedFields: [],
    });
    expect(unchanged).toEqual([]);
  });

  it('does not add a non-versioned field the caller never asked to change', () => {
    const result = reconcileChangedFields({
      before: { platform: 'blog', status: 'draft' },
      after: { platform: 'linkedin', status: 'review' },
      requested: ['status'],
      versionChangedFields: [],
    });
    expect(result).toEqual(['status']);
  });
});
