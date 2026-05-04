export interface TenantHeaders {
  readonly 'X-User-Id': string;
  readonly 'X-Organization-Id': string;
  readonly 'X-Project-Id'?: string;
}

interface VisibilioClientOptions {
  backendUrl: string;
  gatewayUrl: string;
  userApiKey: string;
  internalApiKey?: string;
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

export class VisibilioClient {
  private readonly backendUrl: string;
  private readonly gatewayUrl: string;
  private readonly userApiKey: string;
  private readonly internalApiKey: string | undefined;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: VisibilioClientOptions) {
    this.backendUrl = options.backendUrl.replace(/\/$/, '');
    this.gatewayUrl = options.gatewayUrl.replace(/\/$/, '');
    this.userApiKey = options.userApiKey;
    this.internalApiKey = options.internalApiKey;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  async backendGet(
    path: string,
    tenantHeaders: TenantHeaders,
    params?: Record<string, string | number | undefined>
  ): Promise<unknown> {
    return this.request(
      'GET',
      this.backendUrl + path,
      this.backendHeaders(tenantHeaders),
      undefined,
      params
    );
  }

  async backendPost(path: string, json: unknown, tenantHeaders: TenantHeaders): Promise<unknown> {
    return this.request('POST', this.backendUrl + path, this.backendHeaders(tenantHeaders), json);
  }

  async backendPut(path: string, json: unknown, tenantHeaders: TenantHeaders): Promise<unknown> {
    return this.request('PUT', this.backendUrl + path, this.backendHeaders(tenantHeaders), json);
  }

  async gatewayGet(
    path: string,
    params?: Record<string, string | number | undefined>
  ): Promise<unknown> {
    return this.request('GET', this.gatewayUrl + path, this.gatewayHeaders(), undefined, params);
  }

  async gatewayPost(path: string, json: unknown): Promise<unknown> {
    return this.request('POST', this.gatewayUrl + path, this.gatewayHeaders(), json);
  }

  async gatewayDelete(path: string): Promise<unknown> {
    return this.request('DELETE', this.gatewayUrl + path, this.gatewayHeaders());
  }

  private backendHeaders(tenant: TenantHeaders): Record<string, string> {
    const headers: Record<string, string> = {
      'X-User-Id': tenant['X-User-Id'],
      'X-Organization-Id': tenant['X-Organization-Id'],
      Accept: 'application/json',
    };
    if (tenant['X-Project-Id']) headers['X-Project-Id'] = tenant['X-Project-Id'];
    if (this.internalApiKey) headers['X-Internal-Api-Key'] = this.internalApiKey;
    return headers;
  }

  private gatewayHeaders(): Record<string, string> {
    return {
      'X-API-Key': this.userApiKey,
      Accept: 'application/json',
    };
  }

  private async request(
    method: string,
    url: string,
    headers: Record<string, string>,
    body?: unknown,
    params?: Record<string, string | number | undefined>
  ): Promise<unknown> {
    if (params) {
      const query = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined) query.set(k, String(v));
      }
      const qs = query.toString();
      if (qs) url += (url.includes('?') ? '&' : '?') + qs;
    }
    const allHeaders = { ...headers };
    let serializedBody: string | undefined;
    if (body !== undefined) {
      serializedBody = JSON.stringify(body);
      allHeaders['Content-Type'] = 'application/json';
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        method,
        headers: allHeaders,
        body: serializedBody,
        signal: controller.signal,
      });
      const text = await response.text();
      const parsed = text ? safeJson(text) : null;
      if (!response.ok) {
        throw new HttpError(`${method} ${url} → ${response.status}`, response.status, parsed);
      }
      return parsed;
    } finally {
      clearTimeout(timer);
    }
  }
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
