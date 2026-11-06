import { describe, it, expect, vi } from 'vitest';
import { RequestCancelledError, RequestTimeoutError, VisibilioClient } from '../../src/client.js';
import { runInRequestScope } from '../../src/request-scope.js';

const GATEWAY = 'https://gateway.test';

function okResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response;
}

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
  return new VisibilioClient({
    gatewayUrl: GATEWAY,
    credential: 'vsk_mock',
    timeoutMs,
    fetch: fetchImpl,
  });
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

describe('VisibilioClient — a timeout is distinguishable from a cancellation', () => {
  it('rejects with RequestTimeoutError (not RequestCancelledError) when the client timeout elapses', async () => {
    vi.useFakeTimers();
    const client = makeClient(abortableFetch(), 1000);

    const error = client.get('/api/v2/products').catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1000);

    expect(await error).toBeInstanceOf(RequestTimeoutError);
    expect(await error).not.toBeInstanceOf(RequestCancelledError);
    vi.useRealTimers();
  });
});

describe('VisibilioClient — default timeout covers long gateway operations', () => {
  it('does not cut a request off at 30s and defaults to a 900s (900_000ms) timeout', async () => {
    vi.useFakeTimers();
    const client = makeClient(abortableFetch()); // no timeoutMs: uses the client default

    let settled = false;
    const error = client.get('/api/v2/products').then(
      () => {
        settled = true;
      },
      (e: unknown) => {
        settled = true;
        return e;
      }
    );

    await vi.advanceTimersByTimeAsync(30_000);
    expect(settled).toBe(false); // the old 30s default would have aborted here

    await vi.advanceTimersByTimeAsync(900_000 - 30_000);
    expect(settled).toBe(true);
    expect(await error).toBeInstanceOf(RequestTimeoutError);
    vi.useRealTimers();
  });
});

describe('VisibilioClient — progress heartbeat during a long gateway call', () => {
  it('calls the scope reporter periodically while a gateway call is in flight', async () => {
    vi.useFakeTimers();
    const reportProgress = vi.fn();
    let resolveFetch!: (response: Response) => void;
    const fetchImpl = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        })
    ) as unknown as typeof fetch;
    const client = makeClient(fetchImpl);

    const promise = runInRequestScope({ reportProgress }, () => client.get('/api/v2/products'));
    await vi.advanceTimersByTimeAsync(25_000 * 2 + 10);
    expect(reportProgress.mock.calls.length).toBeGreaterThanOrEqual(2);

    resolveFetch(okResponse({ products: [] }));
    expect(await promise).toEqual({ products: [] });
    vi.useRealTimers();
  });
});
