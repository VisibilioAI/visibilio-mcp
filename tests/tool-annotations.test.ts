import { describe, it, expect } from 'vitest';
import { readOnly, mutating, destructive, openWorld } from '../src/tools/_define.js';
import { allTools } from '../src/tools/index.js';

function annotationOf(name: string) {
  const tool = allTools.find((t) => t.name === name);
  expect(tool, name).toBeDefined();
  return tool!.annotations;
}

describe('annotation presets', () => {
  it('mutating marks an additive write: not read-only and not destructive', () => {
    expect(mutating.readOnlyHint).toBe(false);
    expect(mutating.destructiveHint).toBe(false);
  });

  it('destructive marks an irreversible write: not read-only and destructive', () => {
    expect(destructive.readOnlyHint).toBe(false);
    expect(destructive.destructiveHint).toBe(true);
  });

  it('mutating and destructive differ on destructiveHint', () => {
    expect(mutating.destructiveHint).not.toBe(destructive.destructiveHint);
  });

  it('closed-world presets set openWorldHint false', () => {
    expect(readOnly.openWorldHint).toBe(false);
    expect(mutating.openWorldHint).toBe(false);
    expect(destructive.openWorldHint).toBe(false);
  });

  it('openWorld marks a non-destructive write that reaches outside the platform', () => {
    expect(openWorld.readOnlyHint).toBe(false);
    expect(openWorld.destructiveHint).toBe(false);
    expect(openWorld.openWorldHint).toBe(true);
  });
});

describe('search_knowledge is not read-only', () => {
  it('posts and can trigger a paid model call, so it is not readOnly and is open-world', () => {
    const a = annotationOf('search_knowledge');
    expect(a.readOnlyHint).toBe(false);
    expect(a.openWorldHint).toBe(true);
  });
});

describe('outside-world tools set openWorldHint', () => {
  it.each(['publish_social_post', 'publish_to_hub', 'scan_source', 'send_feedback'])(
    '%s reaches outside the platform so it is open-world',
    (name) => {
      expect(annotationOf(name).openWorldHint).toBe(true);
    }
  );
});

describe('additive writes are not announced destructive', () => {
  it.each(['create_content_item', 'update_knowledge', 'create_product', 'create_audience'])(
    '%s is a mutating write, not a destructive one',
    (name) => {
      const a = annotationOf(name);
      expect(a.readOnlyHint).toBe(false);
      expect(a.destructiveHint).toBe(false);
    }
  );
});

describe('irreversible writes stay destructive', () => {
  it.each([
    'delete_content_item',
    'delete_brief',
    'delete_audience',
    'cancel_schedule',
    'cancel_workflow',
  ])('%s remains destructive', (name) => {
    expect(annotationOf(name).destructiveHint).toBe(true);
  });
});
