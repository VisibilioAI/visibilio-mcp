import { describe, it, expect, vi } from 'vitest';
import { RequestCancelledError, VisibilioClient } from '../../src/client.js';
import { runInRequestScope } from '../../src/request-scope.js';

const GATEWAY = 'https://gateway.test';

/** A fetch that never settles on its own; it rejects (like native fetch) only when its signal aborts. */
function abortableFetch(onCall?: (signal: AbortSignal | undefined) => void): typeof fetch {
  return vi.fn((_url: string, init?: RequestInit) => {
    onCall?.(init?.signal ?? undefined);
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
        'abort',
        () => reject(new DOMException('aborted', 'AbortError')),
        { once: true }
      );
    });
  }) as unknown as typeof fetch;
}

function makeClient(fetchImpl: typeof fetch, timeoutMs?: number): VisibilioClient {
  return new VisibilioClient({ gatewayUrl: GATEWAY, credential: 'vsk_mock', timeoutMs, fetch: fetchImpl });
}

describe('VisibilioClient — caller cancellation propagates to the gateway fetch', () => {
  it('aborts the in-flight gateway fetch and rejects with RequestCancelledError when the caller cancels', async () => {
    const external = new AbortController();
    let fetchSignal: AbortSignal | undefined;
    const fetchImpl = abortableFetch((signal) => {
      fetchSignal = signal;
    });
    const client = makeClient(fetchImpl);

    const promise = runInRequestScope({ signal: external.signal }, () =>
      client.get('/api/v2/products')
    );
    const assertion = expect(promise).rejects.toBeInstanceOf(RequestCancelledError);
    external.abort();
    await assertion;

    expect(fetchSignal?.aborted).toBe(true);
  });
});
