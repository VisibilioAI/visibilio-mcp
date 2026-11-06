import { currentRequestScope } from './request-scope.js';

export type QueryParams = Record<string, string | number | boolean | undefined>;

interface VisibilioClientOptions {
  gatewayUrl: string;
  credential: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export class HttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export class RequestCancelledError extends Error {
  constructor(
    public readonly method: string,
    public readonly requestUrl: string
  ) {
    super(`${method} ${requestUrl} was cancelled by the client`);
    this.name = 'RequestCancelledError';
  }
}

export class RequestTimeoutError extends Error {
  constructor(
    public readonly method: string,
    public readonly requestUrl: string,
    public readonly timeoutMs: number
  ) {
    super(`${method} ${requestUrl} timed out after ${timeoutMs}ms`);
    this.name = 'RequestTimeoutError';
  }
}

const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);
const RETRYABLE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const MAX_RETRY_ATTEMPTS = 3;
const BASE_DELAY_MS = 1000;
const BREAKER_BASE_DELAY_MS = 2000;

export class VisibilioClient {
  private readonly gatewayUrl: string;
  private credential: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private activeOrganizationId: number | null = null;

  constructor(options: VisibilioClientOptions) {
    this.gatewayUrl = options.gatewayUrl.replace(/\/$/, '');
    this.credential = options.credential;
    this.timeoutMs = options.timeoutMs ?? 900_000;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  /** A renewed OAuth access token of the same user replaces the one this client was built with. */
  setCredential(credential: string): void {
    this.credential = credential;
  }

  setActiveOrganization(organizationId: number | null): void {
    this.activeOrganizationId = organizationId;
  }

  get(path: string, params?: QueryParams): Promise<unknown> {
    return this.request('GET', path, undefined, params);
  }

  post(path: string, json?: unknown, params?: QueryParams): Promise<unknown> {
    return this.request('POST', path, json ?? {}, params);
  }

  put(path: string, json: unknown): Promise<unknown> {
    return this.request('PUT', path, json);
  }

  patch(path: string, json: unknown): Promise<unknown> {
    return this.request('PATCH', path, json);
  }

  delete(path: string, json?: unknown): Promise<unknown> {
    return this.request('DELETE', path, json);
  }

  private async request(
    method: string,
    path: string,
    body?: unknown,
    params?: QueryParams
  ): Promise<unknown> {
    const url = this.gatewayUrl + path + buildQuery(params);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.credential}`,
      Accept: 'application/json',
    };
    if (this.activeOrganizationId !== null) {
      headers['X-Organization-Id'] = String(this.activeOrganizationId);
    }
    let serializedBody: string | undefined;
    if (body !== undefined) {
      serializedBody = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
    }
    return this.fetchWithBackoff(method, url, headers, serializedBody, 0);
  }

  private async fetchWithBackoff(
    method: string,
    url: string,
    headers: Record<string, string>,
    body: string | undefined,
    attempt: number
  ): Promise<unknown> {
    const external = currentRequestScope()?.signal;
    if (external?.aborted) throw new RequestCancelledError(method, url);

    const controller = new AbortController();
    let abortReason: 'timeout' | 'cancel' | null = null;
    const timer = setTimeout(() => {
      abortReason = 'timeout';
      controller.abort();
    }, this.timeoutMs);
    const onExternalAbort = () => {
      abortReason = 'cancel';
      controller.abort();
    };
    external?.addEventListener('abort', onExternalAbort, { once: true });
    let response: Response;
    try {
      response = await this.fetchImpl(url, { method, headers, body, signal: controller.signal });
    } catch (err) {
      if (abortReason === 'cancel') throw new RequestCancelledError(method, url);
      if (abortReason === 'timeout') throw new RequestTimeoutError(method, url, this.timeoutMs);
      throw err;
    } finally {
      clearTimeout(timer);
      external?.removeEventListener('abort', onExternalAbort);
    }

    if (
      RETRYABLE_METHODS.has(method) &&
      RETRYABLE_STATUSES.has(response.status) &&
      attempt < MAX_RETRY_ATTEMPTS
    ) {
      await sleep(computeBackoffDelay(response, attempt));
      return this.fetchWithBackoff(method, url, headers, body, attempt + 1);
    }

    const text = await response.text();
    const parsed = text ? safeJson(text) : null;
    if (!response.ok) {
      throw new HttpError(`${method} ${url} → ${response.status}`, response.status, parsed);
    }
    return parsed;
  }
}

function buildQuery(params?: QueryParams): string {
  if (!params) return '';
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, String(value));
  }
  const qs = query.toString();
  return qs ? `?${qs}` : '';
}

function computeBackoffDelay(response: Response, attempt: number): number {
  const retryAfterRaw = response.headers.get('Retry-After');
  const retryAfterMs = retryAfterRaw ? Number.parseInt(retryAfterRaw, 10) * 1000 : 0;
  const baseDelay = response.status === 503 ? BREAKER_BASE_DELAY_MS : BASE_DELAY_MS;
  return Math.max(retryAfterMs, baseDelay * Math.pow(2, attempt));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function isRetryable(error: unknown): boolean {
  return error instanceof HttpError && RETRYABLE_STATUSES.has(error.status);
}
