import { describe, it, expect, vi } from 'vitest';
import { z, type ZodTypeAny } from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildServer } from '../../src/server.js';
import { allTools, type ToolDefinition } from '../../src/tools/index.js';
import { buildSession, callTool } from './_helpers.js';

interface GatewayReply {
  readonly status: number;
  readonly body: unknown;
}

type GatewayAnswer = GatewayReply | Error;

const ME: GatewayReply = {
  status: 200,
  body: {
    user: { id: 42, email: 'owner@example.com', name: 'Owner Example' },
    organizations: [{ id: 7, name: 'Primary Org', role: 'owner' }],
    default_organization_id: 7,
  },
};

function gatewayAnswering(answers: Record<string, GatewayAnswer>): typeof fetch {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${(init?.method ?? 'GET').toUpperCase()} ${new URL(url).pathname}`;
    const answer = answers[key];
    if (answer === undefined) throw new Error(`No gateway answer for ${key}`);
    if (answer instanceof Error) throw answer;
    return {
      ok: answer.status >= 200 && answer.status < 300,
      status: answer.status,
      headers: { get: () => null },
      text: async () => JSON.stringify(answer.body),
      json: async () => answer.body,
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

async function connectedClient(answers: Record<string, GatewayAnswer>): Promise<Client> {
  const { server } = await buildServer({
    settings: { gatewayUrl: 'https://gateway.test', credential: 'vsk_test', timeoutMs: 30_000 },
    fetch: gatewayAnswering({ 'GET /api/v2/auth/me': ME, ...answers }),
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'tool-failures-test', version: '0.0.0' });
  await client.connect(clientTransport);
  return client;
}

describe('a tool call over the MCP protocol reports its failure with isError', () => {
  it('a gateway HTTP error returns isError: true with the text the tool returned before', async () => {
    const client = await connectedClient({
      'POST /api/v2/products/1/content-items': {
        status: 422,
        body: { error: 'VALIDATION_ERROR', message: 'Validation failed' },
      },
    });

    const result = await client.callTool({
      name: 'create_content_item',
      arguments: { product_id: 1, type: 'article', title: 'A title', body: '<p>Body</p>' },
    });

    expect(result).toEqual({
      content: [{ type: 'text', text: 'Create content item failed (HTTP 422): Validation failed' }],
      isError: true,
    });
    await client.close();
  });

  it('a ToolError returns isError: true with the text the tool returned before', async () => {
    const client = await connectedClient({});

    const result = await client.callTool({ name: 'list_content_items', arguments: {} });

    expect(result).toEqual({
      content: [
        {
          type: 'text',
          text: 'Error: No active product. Call list_products, then set_active_product (or pass product_id).',
        },
      ],
      isError: true,
    });
    await client.close();
  });

  // Regression guard — already passes; locks in current behavior so future refactors cannot regress.
  it('a successful call returns its text without isError', async () => {
    const client = await connectedClient({});

    const result = await client.callTool({ name: 'whoami', arguments: {} });

    expect(result.isError).toBeUndefined();
    expect(result.content).toEqual([
      { type: 'text', text: expect.stringContaining('User: Owner Example <owner@example.com>') },
    ]);
    await client.close();
  });

  // Regression guard — already passes; locks in current behavior so future refactors cannot regress.
  it('an unexpected error, such as an unreachable gateway, returns isError: true with its message', async () => {
    const client = await connectedClient({
      'GET /api/v2/content-items/1': new TypeError('fetch failed'),
    });

    const result = await client.callTool({
      name: 'get_content_item',
      arguments: { content_item_id: 1 },
    });

    expect(result).toEqual({ content: [{ type: 'text', text: 'fetch failed' }], isError: true });
    await client.close();
  });
});

function sampleOf(schema: ZodTypeAny): unknown {
  if (schema instanceof z.ZodNumber) return 1;
  if (schema instanceof z.ZodString) return 'x';
  if (schema instanceof z.ZodBoolean) return true;
  if (schema instanceof z.ZodEnum) return schema.options[0];
  if (schema instanceof z.ZodArray) return [sampleOf(schema.element)];
  if (schema instanceof z.ZodRecord) return { key: 'value' };
  if (schema instanceof z.ZodObject) return requiredSamplesOf(schema.shape);
  throw new Error(`No sample value for a required ${schema._def.typeName} argument`);
}

function requiredSamplesOf(shape: Record<string, ZodTypeAny>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(shape)
      .filter(([, schema]) => !schema.isOptional())
      .map(([key, schema]) => [key, sampleOf(schema)])
  );
}

async function outcomeOf(tool: ToolDefinition, status: number) {
  const { session, calls } = buildSession([
    { match: () => true, status, body: { error: 'GATEWAY_ERROR', message: 'Gateway failure' } },
  ]);
  await session.setActiveProduct(1, 'Product');
  const result = await callTool(tool.name, requiredSamplesOf(tool.inputSchema), session);
  return { name: tool.name, reachedGateway: calls.length > 0, isError: result.isError === true };
}

// Regression guard — already passes; locks in current behavior so future refactors cannot regress.
// It catches a tool that turns a gateway error status into a normal result. It does not catch a
// tool that turns a successful gateway answer into failure-looking text, or a failure that never
// reaches the gateway.
describe('every tool reports a gateway error with isError', () => {
  it.each([404, 422, 500])(
    'each tool that reaches the gateway and gets HTTP %i returns isError: true',
    async (status) => {
      const outcomes = await Promise.all(allTools.map((tool) => outcomeOf(tool, status)));
      const reached = outcomes.filter((outcome) => outcome.reachedGateway);

      expect(reached.length).toBeGreaterThan(allTools.length * 0.9);
      expect(reached.filter((outcome) => !outcome.isError).map((outcome) => outcome.name)).toEqual(
        []
      );
    }
  );
});
