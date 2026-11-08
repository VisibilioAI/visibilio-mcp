import { describe, it, expect } from 'vitest';
import { buildSession, callTool, jsonBodyOf, pathMatcher, textOf } from './_helpers.js';

describe('feedback', () => {
  it('send_feedback posts the message, rating and the mcp page_url and confirms it was sent', async () => {
    const { session, calls } = buildSession([
      { match: pathMatcher('POST', '/api/v2/feedback'), body: { success: true } },
    ]);

    const result = await callTool(
      'send_feedback',
      { message: 'Love the MCP tools', rating: 5 },
      session
    );

    expect(calls[0]!.url).toContain('/api/v2/feedback');
    expect(jsonBodyOf(calls[0])).toEqual({
      message: 'Love the MCP tools',
      rating: 5,
      page_url: 'mcp://visibilio',
    });
    expect(textOf(result)).toBe('Thanks, your feedback was sent to the Visibilio team.');
  });

  it('send_feedback omits the rating when none is supplied', async () => {
    const { session, calls } = buildSession([
      { match: pathMatcher('POST', '/api/v2/feedback'), body: { success: true } },
    ]);

    await callTool('send_feedback', { message: 'The repurpose tool confused me' }, session);

    expect(jsonBodyOf(calls[0])).toEqual({
      message: 'The repurpose tool confused me',
      page_url: 'mcp://visibilio',
    });
  });
});
