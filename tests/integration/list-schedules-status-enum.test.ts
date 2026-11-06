import { describe, it, expect } from 'vitest';
import { allTools } from '../../src/tools/index.js';

const SERVER_ACCEPTED_STATUSES = [
  'scheduled',
  'publishing',
  'published',
  'failed',
  'cancelled',
] as const;

function statusSchema() {
  const tool = allTools.find((t) => t.name === 'list_schedules');
  if (!tool) throw new Error('list_schedules tool is not registered');
  const schema = tool.inputSchema.status;
  if (!schema) throw new Error('list_schedules has no status input');
  return schema;
}

describe('list_schedules status schema matches the documented contract', () => {
  it('rejects a status outside the documented set (the reporter "bogus" case)', () => {
    expect(statusSchema().safeParse('bogus').success).toBe(false);
  });

  it('rejects an empty status', () => {
    expect(statusSchema().safeParse('').success).toBe(false);
  });

  it('accepts each documented status value', () => {
    for (const status of SERVER_ACCEPTED_STATUSES) {
      expect(statusSchema().safeParse(status).success, status).toBe(true);
    }
  });

  it('accepts an omitted status (optional)', () => {
    expect(statusSchema().safeParse(undefined).success).toBe(true);
  });
});
