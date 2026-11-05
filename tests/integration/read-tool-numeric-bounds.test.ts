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

describe('get_operation_overview.period_hours is bounded', () => {
  const periodHours = () => field('get_operation_overview', 'period_hours');

  it('rejects an out-of-range period_hours (the reporter 1000000000 case)', () => {
    expect(periodHours().safeParse(1000000000).success).toBe(false);
  });

  it('rejects a negative period_hours (the reporter -1 case)', () => {
    expect(periodHours().safeParse(-1).success).toBe(false);
  });

  it('rejects zero period_hours', () => {
    expect(periodHours().safeParse(0).success).toBe(false);
  });

  it('accepts the documented default window', () => {
    expect(periodHours().safeParse(168).success).toBe(true);
    expect(periodHours().safeParse(8760).success).toBe(true);
  });

  it('accepts an omitted period_hours (optional)', () => {
    expect(periodHours().safeParse(undefined).success).toBe(true);
  });
});

describe('list_notifications.offset is non-negative', () => {
  const offset = () => field('list_notifications', 'offset');

  it('rejects a negative offset (the reporter -1 case)', () => {
    expect(offset().safeParse(-1).success).toBe(false);
  });

  it('accepts a zero offset', () => {
    expect(offset().safeParse(0).success).toBe(true);
  });

  it('accepts an omitted offset (optional)', () => {
    expect(offset().safeParse(undefined).success).toBe(true);
  });
});
