import { describe, it, expect } from 'vitest';
import { hasAnyArg } from '../src/tools/_define.js';

describe('hasAnyArg', () => {
  it('returns true when a listed key is present with a value', () => {
    expect(hasAnyArg({ status: 'draft' }, ['status', 'content_type'])).toBe(true);
  });

  it('returns true when the present value is the boolean false', () => {
    expect(hasAnyArg({ is_active: false }, ['type', 'is_active'])).toBe(true);
  });

  it('returns false when none of the listed keys are present', () => {
    expect(hasAnyArg({ limit: 10, offset: 0 }, ['status'])).toBe(false);
  });

  it('returns false when listed keys are present but only hold null or undefined', () => {
    expect(hasAnyArg({ status: null, content_type: undefined }, ['status', 'content_type'])).toBe(
      false
    );
  });

  it('ignores keys that are not in the list', () => {
    expect(hasAnyArg({ product_id: 147 }, ['status'])).toBe(false);
  });

  it('returns false for an empty key list', () => {
    expect(hasAnyArg({ status: 'draft' }, [])).toBe(false);
  });
});
