export type PublicationSyncState = 'in_sync' | 'drifted' | 'unknown';

export function publicationSyncState({
  publishedVersion,
  currentVersion,
}: {
  publishedVersion?: number | null;
  currentVersion?: number | null;
}): PublicationSyncState {
  if (typeof publishedVersion !== 'number' || typeof currentVersion !== 'number') {
    return 'unknown';
  }
  if (publishedVersion === currentVersion) return 'in_sync';
  if (publishedVersion < currentVersion) return 'drifted';
  return 'unknown';
}
