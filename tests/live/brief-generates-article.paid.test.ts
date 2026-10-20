import { describe, it, expect } from 'vitest';
import { connectLiveMcp, liveFixture, type LiveMcp } from './_live-client.js';

const RUN_BUDGET_MS = 12 * 60_000;

function valueAfter(label: string, text: string): string {
  const match = new RegExp(`${label}:? (\\S+)`).exec(text);
  if (!match?.[1]) {
    throw new Error(`No ${label} in the tool result.`);
  }
  return match[1].replace(/[,.]$/, '');
}

function lineStartingWith(prefix: string, text: string): string | undefined {
  return text.split('\n').find((line) => line.startsWith(prefix));
}

function outcomeOf(status: string): string {
  return [lineStartingWith('state:', status), lineStartingWith('error:', status)]
    .filter((line): line is string => line !== undefined)
    .join(' | ');
}

async function finalStatus(mcp: LiveMcp, executionId: string): Promise<string> {
  const deadline = Date.now() + RUN_BUDGET_MS;
  while (Date.now() < deadline) {
    const status = await mcp.call('get_workflow_status', { execution_id: executionId });
    if (!status.includes('Still running')) return status;
  }
  return `state: still running after ${RUN_BUDGET_MS / 60_000} minutes`;
}

describe('J2 (paid): a brief generates an article that is saved under the active product', () => {
  it(
    'generate_from_brief completes, and create_content_item saves the run in the product',
    async () => {
      const fixture = liveFixture();
      const mcp = await connectLiveMcp(fixture);
      try {
        await mcp.call('set_active_product', { product_id: fixture.productId });
        const briefId = Number(
          valueAfter(
            'brief_id',
            await mcp.call('create_brief', {
              title: `J2 live journey ${new Date().toISOString()}`,
              content_type: 'article',
              topic: 'Three practical checks before you publish a technical blog article in 2026',
              language: 'en',
            })
          )
        );
        try {
          const executionId = valueAfter(
            'execution_id',
            await mcp.call('generate_from_brief', { brief_id: briefId })
          );
          const status = await finalStatus(mcp, executionId);
          expect(outcomeOf(status)).toBe('state: completed');

          const saved = await mcp.call('create_content_item', {
            type: 'article',
            source_execution_id: executionId,
          });
          expect(saved.split('\n')[0]).toBe('Content item created.');
          const itemId = Number(valueAfter('content_item_id', saved));
          try {
            expect(lineStartingWith('product_id:', saved)).toBe(`product_id: ${fixture.productId}`);
          } finally {
            await mcp.call('delete_content_item', { content_item_id: itemId });
          }
        } finally {
          await mcp.call('delete_brief', { brief_id: briefId });
        }
      } finally {
        await mcp.close();
      }
    },
    RUN_BUDGET_MS + 3 * 60_000
  );
});
