import { describe, it, expect, vi } from 'vitest';
import { buildRequestScope } from '../src/server.js';

type ToolExtra = Parameters<typeof buildRequestScope>[0];

function makeExtra(overrides: Record<string, unknown>): ToolExtra {
  return {
    signal: new AbortController().signal,
    requestId: 1,
    sendNotification: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as ToolExtra;
}

describe('buildRequestScope maps the SDK tool extra to a request scope', () => {
  it('carries the caller cancellation signal', () => {
    const signal = new AbortController().signal;

    const scope = buildRequestScope(makeExtra({ signal }));

    expect(scope.signal).toBe(signal);
  });

  it('builds a reporter that sends a notifications/progress when a progressToken is present', () => {
    const sendNotification = vi.fn(async () => undefined);

    const scope = buildRequestScope(
      makeExtra({ _meta: { progressToken: 'tok-1' }, sendNotification })
    );

    expect(typeof scope.reportProgress).toBe('function');
    scope.reportProgress?.();
    expect(sendNotification).toHaveBeenCalledWith({
      method: 'notifications/progress',
      params: { progressToken: 'tok-1', progress: 1 },
    });
  });

  it('has no reporter when the caller supplies no progressToken', () => {
    const scope = buildRequestScope(makeExtra({ _meta: {} }));

    expect(scope.reportProgress).toBeUndefined();
  });
});
