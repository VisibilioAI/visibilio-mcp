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

const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);
const MAX_RETRY_ATTEMPTS = 3;
const BASE_DELAY_MS = 1000;
const BREAKER_BASE_DELAY_MS = 2000;

export class VisibilioClient {
  private readonly gatewayUrl: string;
  private readonly credential: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private activeOrganizationId: number | null = null;

  constructor(options: VisibilioClientOptions) {
    this.gatewayUrl = options.gatewayUrl.replace(/\/$/, '');
    this.credential = options.credential;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
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
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(url, { method, headers, body, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }

    if (RETRYABLE_STATUSES.has(response.status) && attempt < MAX_RETRY_ATTEMPTS) {
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
