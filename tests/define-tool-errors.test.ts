import { describe, it, expect } from 'vitest';
import { defineTool, readOnly } from '../src/tools/_define.js';
import { RequestCancelledError, RequestTimeoutError } from '../src/client.js';
import type { McpSession } from '../src/session.js';

const session = {} as McpSession;

function toolThatThrows(error: Error) {
  return defineTool({
    name: 'probe',
    title: 'Probe',
    description: 'A probe tool for error-surfacing tests.',
    inputSchema: {},
    annotations: readOnly,
    handler: async () => {
      throw error;
    },
  });
}

describe('defineTool surfaces timeout and cancellation as distinct failures', () => {
  it('surfaces a timeout as a failure that says the operation timed out', async () => {
    const tool = toolThatThrows(new RequestTimeoutError('GET', '/api/v2/products', 900_000));

    const output = await tool.handler({}, session);

    expect(output).toHaveProperty('failure');
    expect((output as { failure: string }).failure.toLowerCase()).toContain('timed out');
  });

  it('surfaces a client cancellation as a failure that says it was cancelled', async () => {
    const tool = toolThatThrows(new RequestCancelledError('GET', '/api/v2/products'));

    const output = await tool.handler({}, session);

    expect(output).toHaveProperty('failure');
    expect((output as { failure: string }).failure.toLowerCase()).toContain('cancel');
  });
});
