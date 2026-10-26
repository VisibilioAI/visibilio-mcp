export type PublicationSyncState = 'in_sync' | 'drifted' | 'unknown';

const NON_VERSIONED_FIELDS = [
  'status',
  'platform',
  'tags',
  'categories',
  'seo_meta',
  'canonical_url',
  'body_format',
  'featured_image_url',
] as const;

function canonical(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function reconcileChangedFields({
  before,
  after,
  requested,
  versionChangedFields,
}: {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  requested: readonly string[];
  versionChangedFields?: readonly string[];
}): string[] {
  const result = [...(versionChangedFields ?? [])];
  for (const field of NON_VERSIONED_FIELDS) {
    if (
      requested.includes(field) &&
      canonical(before[field]) !== canonical(after[field]) &&
      !result.includes(field)
    ) {
      result.push(field);
    }
  }
  return result;
}

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
