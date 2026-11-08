import { describe, it, expect } from 'vitest';
import request from 'supertest';
import type { ZodTypeAny } from 'zod';
import { allTools } from '../../src/tools/index.js';
import { buildHttpApp } from '../../src/http-app.js';
import type { BaseSettings } from '../../src/config.js';
import { buildSession, pathMatcher } from './_helpers.js';

function toolDef(name: string) {
  const tool = allTools.find((t) => t.name === name);
  if (!tool) throw new Error(`tool ${name} is not registered`);
  return tool;
}

function field(toolName: string, fieldName: string): ZodTypeAny {
  const shape = toolDef(toolName).inputSchema as Record<string, ZodTypeAny>;
  const schema = shape[fieldName];
  if (!schema) throw new Error(`${toolName}.${fieldName} is not in the input schema`);
  return schema;
}

function optionalField(toolName: string, fieldName: string): ZodTypeAny | undefined {
  const shape = toolDef(toolName).inputSchema as Record<string, ZodTypeAny>;
  return shape[fieldName];
}

const ok = (schema: ZodTypeAny, value: unknown): boolean => schema.safeParse(value).success;

// --- C21: planned topic ids are UUIDs, not integers (FB-60) ---
describe('C21 get_planned_topic_brief.topic_id is a UUID string', () => {
  it('accepts a UUID and rejects an integer or a non-UUID string', () => {
    const schema = field('get_planned_topic_brief', 'topic_id');
    expect(ok(schema, '3f2504e0-4f89-41d3-9a0c-0305e82c3301')).toBe(true);
    expect(ok(schema, 5)).toBe(false);
    expect(ok(schema, 'not-a-uuid')).toBe(false);
  });
});

// --- C4: the update status enum must not offer scheduled/published ---
describe('C4 update_content_item.status excludes scheduled and published', () => {
  it('rejects scheduled and published, accepts draft/approved/archived', () => {
    const schema = field('update_content_item', 'status');
    expect(ok(schema, 'scheduled')).toBe(false);
    expect(ok(schema, 'published')).toBe(false);
    expect(ok(schema, 'draft')).toBe(true);
    expect(ok(schema, 'approved')).toBe(true);
    expect(ok(schema, 'archived')).toBe(true);
  });

  it('list_content_items.status still accepts scheduled and published (it is a filter)', () => {
    // Regression guard — already passes; the list filter keeps the full status set.
    const schema = field('list_content_items', 'status');
    expect(ok(schema, 'scheduled')).toBe(true);
    expect(ok(schema, 'published')).toBe(true);
  });
});

// --- C6: schedule_mode drops auto until the auto-schedule path lands ---
describe('C6 quick_repurpose_content_item.schedule_mode drops auto', () => {
  it('rejects auto and accepts draft', () => {
    const schema = field('quick_repurpose_content_item', 'schedule_mode');
    expect(ok(schema, 'auto')).toBe(false);
    expect(ok(schema, 'draft')).toBe(true);
  });
});

// --- C8: create_source.type drops linkedin ---
describe('C8 create_source.type drops linkedin', () => {
  it('rejects linkedin and accepts the supported source types', () => {
    const schema = field('create_source', 'type');
    expect(ok(schema, 'linkedin')).toBe(false);
    for (const type of ['rss', 'website', 'youtube', 'x', 'reddit']) {
      expect(ok(schema, type), type).toBe(true);
    }
  });
});

// --- C18: audience ids are numeric everywhere (gateway ids are bigint) ---
describe('C18 audience ids are numeric', () => {
  it.each([
    ['create_content_item', 'audience_ids'],
    ['update_content_item', 'audience_ids'],
    ['start_workflow', 'audience_ids'],
  ])('%s.%s accepts number[] and rejects string[]', (tool, name) => {
    const schema = field(tool, name);
    expect(ok(schema, [9])).toBe(true);
    expect(ok(schema, ['9'])).toBe(false);
  });

  it('delete_audience.audience_id is numeric', () => {
    // Regression guard — already numeric; this is the canonical shape audience ids follow.
    const schema = field('delete_audience', 'audience_id');
    expect(ok(schema, 9)).toBe(true);
    expect(ok(schema, '9')).toBe(false);
  });
});

// --- C18: execution_id must be a non-empty string ---
describe('C18 execution_id requires a non-empty string', () => {
  it.each([
    ['confirm_workflow'],
    ['get_workflow_status'],
    ['cancel_workflow'],
    ['get_brand_voice_analysis'],
  ])('%s.execution_id rejects an empty string', (tool) => {
    const schema = field(tool, 'execution_id');
    expect(ok(schema, '')).toBe(false);
    expect(ok(schema, 'exec-1')).toBe(true);
  });

  it('create_content_item.source_execution_id rejects an empty string but stays optional', () => {
    const schema = field('create_content_item', 'source_execution_id');
    expect(ok(schema, '')).toBe(false);
    expect(ok(schema, 'exec-1')).toBe(true);
    expect(ok(schema, undefined)).toBe(true);
  });
});

// --- C18: execution_id is URL-encoded when interpolated into a path ---
describe('C18 execution_id is URL-encoded in the gateway path', () => {
  it('get_workflow_status encodes an execution id that contains path characters', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('GET', '/api/v2/workflow/'),
        body: { execution_id: 'a/b', state: 'completed', final_output: { steps: {} } },
      },
    ]);

    await toolDef('get_workflow_status').handler({ execution_id: 'a/b' }, session);

    expect(calls[0]!.url).toContain('/api/v2/workflow/a%2Fb/status');
  });
});

// --- C18: closed-set filters are enums ---
describe('C18 closed-set filters are enums', () => {
  it('list_schedules.status is an enum of the five schedule states', () => {
    // Regression guard — already an enum on origin/main; locks the five allowed states.
    const schema = field('list_schedules', 'status');
    for (const value of ['scheduled', 'publishing', 'published', 'failed', 'cancelled']) {
      expect(ok(schema, value), value).toBe(true);
    }
    expect(ok(schema, 'bogus')).toBe(false);
  });

  it.each([
    ['list_signals', 'source_type'],
    ['list_sources', 'type'],
  ])('%s.%s is a source-type enum', (tool, name) => {
    const schema = field(tool, name);
    expect(ok(schema, 'rss')).toBe(true);
    expect(ok(schema, 'linkedin')).toBe(false);
    expect(ok(schema, 'bogus')).toBe(false);
  });
});

// --- C18: date filters enforce a format ---
// Regression guards — already enforced on origin/main via the isoDate() helper and
// publish_at's datetime schema; kept to lock the format so it cannot regress.
describe('C18 date filters enforce YYYY-MM-DD', () => {
  it.each([
    ['list_planned_topics', 'from'],
    ['list_planned_topics', 'to'],
    ['list_signals', 'since'],
    ['list_schedules', 'from'],
    ['list_schedules', 'to'],
    ['get_published_feed', 'from'],
    ['get_published_feed', 'to'],
  ])('%s.%s accepts a date and rejects a non-date', (tool, name) => {
    const schema = field(tool, name);
    expect(ok(schema, '2026-10-20')).toBe(true);
    expect(ok(schema, 'not-a-date')).toBe(false);
  });

  it('schedule_content_item.publish_at requires an ISO 8601 datetime', () => {
    const schema = field('schedule_content_item', 'publish_at');
    expect(ok(schema, '2026-10-20T09:00:00Z')).toBe(true);
    expect(ok(schema, '2026-10-20')).toBe(false);
    expect(ok(schema, 'nope')).toBe(false);
  });
});

// --- C18: numbers carry bounds (FB-64) ---
// Regression guards — already bounded on origin/main; kept to lock the ranges.
describe('C18 numeric bounds', () => {
  it('list_hub_publications.limit is 1..100', () => {
    const schema = field('list_hub_publications', 'limit');
    expect(ok(schema, 0)).toBe(false);
    expect(ok(schema, 101)).toBe(false);
    expect(ok(schema, 50)).toBe(true);
  });

  it('get_operation_overview.period_hours is 1..8760', () => {
    const schema = field('get_operation_overview', 'period_hours');
    expect(ok(schema, 0)).toBe(false);
    expect(ok(schema, 8761)).toBe(false);
    expect(ok(schema, 168)).toBe(true);
  });

  it('list_notifications.offset is at least 0', () => {
    const schema = field('list_notifications', 'offset');
    expect(ok(schema, -1)).toBe(false);
    expect(ok(schema, 0)).toBe(true);
  });

  it('get_ai_visibility_metrics.cycle is at least 1', () => {
    const schema = field('get_ai_visibility_metrics', 'cycle');
    expect(ok(schema, 0)).toBe(false);
    expect(ok(schema, 1)).toBe(true);
  });
});

// --- C18: mark_notifications_read states its "one of" shape ---
describe('C18 mark_notifications_read.all is literally true', () => {
  it('rejects false and accepts true', () => {
    const schema = field('mark_notifications_read', 'all');
    expect(ok(schema, false)).toBe(false);
    expect(ok(schema, true)).toBe(true);
  });
});

// --- C18: validate_brand_voice documents the product/override contract ---
describe('C18 validate_brand_voice documents the product/override contract', () => {
  it('explains that the item sets the product and content overrides the stored body', () => {
    const description = toolDef('validate_brand_voice').description;
    expect(description).toMatch(/sets the product/i);
    expect(description).toMatch(/instead of the stored body/i);
  });
});

// --- C18: search accepts an optional limit, and honours it ---
describe('C18 search accepts an optional limit', () => {
  it('limit is a 1..100 integer', () => {
    const schema = optionalField('search', 'limit');
    expect(schema).toBeDefined();
    expect(ok(schema!, 10)).toBe(true);
    expect(ok(schema!, 0)).toBe(false);
    expect(ok(schema!, 101)).toBe(false);
  });

  it('caps the number of results it returns', async () => {
    const { session } = buildSession([
      { match: pathMatcher('GET', '/api/v2/products'), body: { data: [{ id: 147, name: 'P' }] } },
      {
        match: pathMatcher('GET', '/api/v2/products/147/content-items'),
        body: {
          data: [
            { id: 1, title: 'One' },
            { id: 2, title: 'Two' },
            { id: 3, title: 'Three' },
          ],
        },
      },
    ]);

    const result = await toolDef('search').handler({ query: 'x', limit: 2 }, session);
    const structured = (result as { structuredContent: { results: unknown[] } }).structuredContent;

    expect(structured.results).toHaveLength(2);
  });
});

// --- S6: no-argument tools advertise a strict empty object ---
const baseSettings: BaseSettings = { gatewayUrl: 'https://gateway.test', timeoutMs: 30_000 };
const ME = {
  user: { id: 42, email: 'owner@example.com', name: 'Owner Example' },
  organizations: [{ id: 158, name: 'Visibilio', role: 'owner' }],
  default_organization_id: 158,
};

function meFetch(): typeof fetch {
  return (async (url: string) => {
    const path = new URL(url).pathname;
    const body = path === '/api/v2/auth/me' ? ME : { error: 'not_found' };
    const status = path === '/api/v2/auth/me' ? 200 : 404;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      text: async () => JSON.stringify(body),
      json: async () => body,
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

interface ListedToolSchema {
  readonly additionalProperties?: unknown;
  readonly properties?: Record<string, unknown>;
}

async function listedToolSchemas(): Promise<Map<string, ListedToolSchema>> {
  const { app } = buildHttpApp({ baseSettings, fetch: meFetch() });
  const headers = (req: request.Test) =>
    req
      .set('Accept', 'application/json, text/event-stream')
      .set('Content-Type', 'application/json')
      .set('Authorization', 'Bearer vsk_valid');
  const init = await headers(request(app).post('/mcp')).send({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 't', version: '0' },
    },
  });
  const sessionId = init.headers['mcp-session-id'] as string;
  const list = await headers(request(app).post('/mcp'))
    .set('Mcp-Session-Id', sessionId)
    .send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  const tools = list.body.result.tools as Array<{ name: string; inputSchema: ListedToolSchema }>;
  return new Map(tools.map((t) => [t.name, t.inputSchema]));
}

describe('S6 no-argument tools advertise a strict empty object', () => {
  // Regression guard — already passes on @modelcontextprotocol/sdk 1.32.1; locks
  // additionalProperties:false so a future SDK or a stray field cannot loosen these tools.
  it.each(['whoami', 'list_organizations', 'list_products', 'list_channels', 'get_product_stats'])(
    '%s publishes additionalProperties:false and no properties',
    async (name) => {
      const schemas = await listedToolSchemas();
      const schema = schemas.get(name);
      expect(schema, name).toBeDefined();
      expect(schema!.additionalProperties).toBe(false);
      expect(Object.keys(schema!.properties ?? {})).toHaveLength(0);
    }
  );
});
