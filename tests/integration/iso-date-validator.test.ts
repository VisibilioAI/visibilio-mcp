import { describe, it, expect } from 'vitest';
import { isoDate } from '../../src/tools/_define.js';

describe('isoDate shared validator', () => {
  it('rejects a non-ISO date format (DD.MM.YYYY)', () => {
    expect(isoDate('from').safeParse('22.10.2026').success).toBe(false);
  });

  it('rejects an unpadded date', () => {
    expect(isoDate('from').safeParse('2026-1-2').success).toBe(false);
  });

  it('rejects free text', () => {
    expect(isoDate('from').safeParse('last tuesday').success).toBe(false);
  });

  it('accepts an ISO date (YYYY-MM-DD)', () => {
    expect(isoDate('from').safeParse('2026-10-22').success).toBe(true);
  });

  it('names the field in the rejection message', () => {
    const result = isoDate('since').safeParse('22.10.2026');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain('since');
    }
  });
});
