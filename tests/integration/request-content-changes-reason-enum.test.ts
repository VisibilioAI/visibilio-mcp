import { describe, it, expect } from 'vitest';
import { allTools } from '../../src/tools/index.js';

const SERVER_ACCEPTED_REASONS = ['wrong_facts', 'wrong_tone', 'off_strategy', 'other'] as const;

function reasonSchema() {
  const tool = allTools.find((t) => t.name === 'request_content_changes');
  if (!tool) throw new Error('request_content_changes tool is not registered');
  const schema = tool.inputSchema.reason;
  if (!schema) throw new Error('request_content_changes has no reason input');
  return schema;
}

describe('request_content_changes reason schema matches the server contract', () => {
  it('rejects a reason that is not one of the four server-accepted values', () => {
    expect(reasonSchema().safeParse('tone').success).toBe(false);
    expect(reasonSchema().safeParse('not_a_reason').success).toBe(false);
  });

  it('accepts each of the four server-accepted reason values', () => {
    // Regression guard — each value already parses under the old open-string schema;
    // locks the enum content to exactly the four values the gateway accepts.
    for (const reason of SERVER_ACCEPTED_REASONS) {
      expect(reasonSchema().safeParse(reason).success, reason).toBe(true);
    }
  });

  it('rejects an empty reason', () => {
    // Regression guard — already rejected by the old .min(1); kept so the enum does not
    // regress to accepting an empty string.
    expect(reasonSchema().safeParse('').success).toBe(false);
  });
});
