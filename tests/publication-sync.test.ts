import { describe, it, expect } from 'vitest';
import { publicationSyncState } from '../src/tools/publication-sync.js';

describe('publicationSyncState — is the live page still what the draft says', () => {
  it('is in_sync when the published version equals the current version', () => {
    expect(publicationSyncState({ publishedVersion: 5, currentVersion: 5 })).toBe('in_sync');
  });

  it('is drifted when the published version is behind the current version', () => {
    expect(publicationSyncState({ publishedVersion: 3, currentVersion: 5 })).toBe('drifted');
  });

  it('is unknown when the published version is ahead of the current version', () => {
    expect(publicationSyncState({ publishedVersion: 6, currentVersion: 5 })).toBe('unknown');
  });

  it('is unknown when the published version was never stamped (null)', () => {
    expect(publicationSyncState({ publishedVersion: null, currentVersion: 5 })).toBe('unknown');
  });

  it('is unknown when the current version is missing', () => {
    expect(publicationSyncState({ publishedVersion: 3, currentVersion: undefined })).toBe('unknown');
  });
});
