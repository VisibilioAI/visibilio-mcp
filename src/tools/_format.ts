export type Row = Record<string, unknown>;

export function line(
  label: string,
  idKey: string,
  id: unknown,
  extras: ReadonlyArray<unknown>
): string {
  const details = extras
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join(', ');
  return `- ${label} (${idKey}: ${String(id)})${details ? ` — ${details}` : ''}`;
}

export function field(name: string, value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (Array.isArray(value)) return value.length ? `${name}: ${value.join(', ')}` : null;
  if (typeof value === 'object') return `${name}: ${JSON.stringify(value)}`;
  return `${name}: ${String(value)}`;
}

export function fields(entries: ReadonlyArray<[string, unknown]>): string {
  return entries
    .map(([name, value]) => field(name, value))
    .filter((s): s is string => s !== null)
    .join('\n');
}

export function listOrEmpty(heading: string, lines: readonly string[], empty: string): string {
  if (lines.length === 0) return empty;
  return `${heading}\n${lines.join('\n')}`;
}

export function truncate(value: unknown, max = 160): string {
  const text = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export function asArray<T = Row>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function nameOf(row: Row): string {
  for (const key of ['name', 'title', 'topic']) {
    if (typeof row[key] === 'string' && (row[key] as string).length > 0) return row[key] as string;
  }
  return 'Untitled';
}
