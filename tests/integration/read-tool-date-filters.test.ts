import { describe, it, expect } from 'vitest';
import { allTools } from '../../src/tools/index.js';
import type { ZodTypeAny } from 'zod';

function field(toolName: string, key: string): ZodTypeAny {
  const tool = allTools.find((t) => t.name === toolName);
  if (!tool) throw new Error(`${toolName} is not registered`);
  const schema = tool.inputSchema[key];
  if (!schema) throw new Error(`${toolName} has no ${key} input`);
  return schema;
}

const DATE_FILTERS: ReadonlyArray<readonly [string, string]> = [
  ['list_schedules', 'from'],
  ['list_schedules', 'to'],
  ['get_published_feed', 'from'],
  ['get_published_feed', 'to'],
  ['list_signals', 'since'],
  ['list_planned_topics', 'from'],
  ['list_planned_topics', 'to'],
];

describe('read-tool date filters enforce an ISO date format', () => {
  it.each(DATE_FILTERS)(
    '%s.%s rejects a non-ISO date (the reporter "22.10.2026" case)',
    (tool, key) => {
      expect(field(tool, key).safeParse('22.10.2026').success).toBe(false);
    }
  );

  it.each(DATE_FILTERS)('%s.%s accepts an ISO date', (tool, key) => {
    expect(field(tool, key).safeParse('2026-10-22').success).toBe(true);
  });

  it.each(DATE_FILTERS)('%s.%s accepts an omitted value (optional)', (tool, key) => {
    expect(field(tool, key).safeParse(undefined).success).toBe(true);
  });
});
