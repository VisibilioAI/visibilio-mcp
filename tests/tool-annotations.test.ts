import { describe, it, expect } from 'vitest';
import {
  readOnly,
  mutating,
  destructive,
  openWorld,
  idempotentWrite,
} from '../src/tools/_define.js';
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

describe('validate_brand_voice is a paid write, not a read', () => {
  it('posts to a paid scoring call, so it is not read-only and not destructive', () => {
    const a = annotationOf('validate_brand_voice');
    expect(a.readOnlyHint).toBe(false);
    expect(a.destructiveHint).toBe(false);
  });
});

describe('generate_seo_meta saves nothing, so it is not destructive', () => {
  it('is a non-destructive compute write', () => {
    // Regression guard - already passes; locks in current behaviour so a future
    // change cannot re-mark this save-nothing suggestion tool as destructive.
    const a = annotationOf('generate_seo_meta');
    expect(a.readOnlyHint).toBe(false);
    expect(a.destructiveHint).toBe(false);
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

describe('scheduling and source creation reach outside the platform', () => {
  it.each(['schedule_content_item', 'create_source'])(
    '%s is an open-world write, not a plain closed-world mutation',
    (name) => {
      const a = annotationOf(name);
      expect(a.openWorldHint).toBe(true);
      expect(a.readOnlyHint).toBe(false);
      expect(a.destructiveHint).toBe(false);
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
    'unpublish_from_hub',
  ])('%s remains destructive', (name) => {
    expect(annotationOf(name).destructiveHint).toBe(true);
  });
});

describe('idempotentWrite preset', () => {
  it('marks an idempotent additive write: not read-only, not destructive, closed-world', () => {
    expect(idempotentWrite.readOnlyHint).toBe(false);
    expect(idempotentWrite.destructiveHint).toBe(false);
    expect(idempotentWrite.idempotentHint).toBe(true);
    expect(idempotentWrite.openWorldHint).toBe(false);
  });
});

describe('update / set-active / mark-read tools announce idempotency', () => {
  it.each([
    'update_brand_voice',
    'update_brief',
    'update_content_item',
    'update_knowledge',
    'update_product',
    'set_active_organization',
    'set_active_product',
    'mark_notifications_read',
  ])('%s sets idempotentHint and stays a non-destructive write', (name) => {
    const a = annotationOf(name);
    expect(a.idempotentHint).toBe(true);
    expect(a.readOnlyHint).toBe(false);
    expect(a.destructiveHint).toBe(false);
  });
});
