import { createHash } from 'node:crypto';

export interface AuthContext {
  readonly userId: number;
  readonly organizationId: number;
  readonly defaultProjectId: string | null;
  readonly subscriptionTier: string;
  readonly scopes: readonly string[];
}

export class AuthenticationError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

interface McpAuthOptions {
  apiKey: string;
  backendUrl: string;
  gatewayUrl?: string;
  oauthClientId?: string;
  oauthClientSecret?: string;
  fetch?: typeof fetch;
}

const ACCESS_TOKEN_PREFIX = 'vat_';
const API_KEY_PREFIX = 'vsk_';
const INTROSPECTION_CACHE_TTL_MS = 60_000;

interface CacheEntry {
  context: AuthContext;
  expiresAtMs: number;
}

/**
 * Module-level cache shared across all McpAuth instances in the process.
 * Keyed by SHA-256 of the raw token so the raw value is never retained
 * in memory beyond the request that resolved it.
 */
const introspectionCache = new Map<string, CacheEntry>();

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

interface IntrospectionResponse {
  active: boolean;
  sub?: string;
  user_id?: number;
  organization_id?: number;
  client_id?: string;
  scope?: string;
  exp?: number;
  token_type?: string;
}

interface ResolveKeyResponse {
  user_id: number;
  organization_id: number;
  default_project_id: string | null;
  subscription_tier: string;
  scopes?: string[];
}

export class McpAuth {
  private readonly apiKey: string;
  private readonly backendUrl: string;
  private readonly gatewayUrl: string | null;
  private readonly oauthClientId: string | null;
  private readonly oauthClientSecret: string | null;
  private readonly fetchImpl: typeof fetch;
  private context: AuthContext | null = null;

  constructor(options: McpAuthOptions) {
    this.apiKey = options.apiKey;
    this.backendUrl = options.backendUrl.replace(/\/$/, '');
    this.gatewayUrl = options.gatewayUrl ? options.gatewayUrl.replace(/\/$/, '') : null;
    this.oauthClientId = options.oauthClientId ?? null;
    this.oauthClientSecret = options.oauthClientSecret ?? null;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  isResolved(): boolean {
    return this.context !== null;
  }

  cachedContext(): AuthContext {
    if (!this.context) {
      throw new Error('McpAuth.cachedContext() called before resolve()');
    }
    return this.context;
  }

  async resolve(): Promise<AuthContext> {
    if (this.context) return this.context;
    if (this.apiKey.startsWith(ACCESS_TOKEN_PREFIX)) {
      this.context = await this.resolveOAuthToken(this.apiKey);
    } else if (this.apiKey.startsWith(API_KEY_PREFIX)) {
      this.context = await this.resolveApiKey(this.apiKey);
    } else {
      throw new AuthenticationError(
        `Unknown token format — expected vsk_* (API key) or vat_* (OAuth)`,
        401
      );
    }
    return this.context;
  }

  private async resolveApiKey(rawKey: string): Promise<AuthContext> {
    const url = `${this.backendUrl}/api/v2/auth/resolve-key`;
    const response = await this.fetchImpl(url, {
      method: 'GET',
      headers: { 'X-API-Key': rawKey, Accept: 'application/json' },
    });
    if (!response.ok) {
      throw new AuthenticationError(
        `Auth failed (${response.status}) — check VISIBILIO_API_KEY`,
        response.status
      );
    }
    const body = (await response.json()) as ResolveKeyResponse;
    return {
      userId: body.user_id,
      organizationId: body.organization_id,
      defaultProjectId: body.default_project_id,
      subscriptionTier: body.subscription_tier,
      scopes: body.scopes ?? ['mcp:read', 'mcp:write'],
    };
  }

  private async resolveOAuthToken(rawToken: string): Promise<AuthContext> {
    if (!this.gatewayUrl) {
      throw new AuthenticationError(
        'OAuth tokens require VISIBILIO_GATEWAY_URL to be configured',
        500
      );
    }
    if (!this.oauthClientId || !this.oauthClientSecret) {
      throw new AuthenticationError(
        'OAuth tokens require VISIBILIO_OAUTH_CLIENT_ID and VISIBILIO_OAUTH_CLIENT_SECRET',
        500
      );
    }

    const cacheKey = hashToken(rawToken);
    const cached = introspectionCache.get(cacheKey);
    if (cached && cached.expiresAtMs > Date.now()) {
      return cached.context;
    }

    const credentials = Buffer.from(`${this.oauthClientId}:${this.oauthClientSecret}`).toString(
      'base64'
    );
    const response = await this.fetchImpl(`${this.gatewayUrl}/api/v2/oauth/introspect`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({ token: rawToken, token_type_hint: 'access_token' }).toString(),
    });
    if (!response.ok) {
      throw new AuthenticationError(
        `OAuth introspection failed (${response.status})`,
        response.status === 401 ? 401 : 500
      );
    }
    const body = (await response.json()) as IntrospectionResponse;
    if (!body.active) {
      throw new AuthenticationError('OAuth token is not active', 401);
    }
    if (typeof body.user_id !== 'number' || typeof body.organization_id !== 'number') {
      throw new AuthenticationError('OAuth introspection response missing user/org', 500);
    }

    const scopes = (body.scope ?? '').split(/\s+/).filter(Boolean);
    const context: AuthContext = {
      userId: body.user_id,
      organizationId: body.organization_id,
      defaultProjectId: null, // OAuth tokens don't carry a default project — set via tools/set_active_project
      subscriptionTier: 'pro', // not surfaced by introspect; treat OAuth-authenticated as pro
      scopes,
    };

    // Cache TTL: 60s, capped at the token's exp if it's sooner.
    const ttlFromExp = body.exp ? body.exp * 1000 - Date.now() : Number.POSITIVE_INFINITY;
    const ttl = Math.min(INTROSPECTION_CACHE_TTL_MS, ttlFromExp);
    if (ttl > 0) {
      introspectionCache.set(cacheKey, { context, expiresAtMs: Date.now() + ttl });
    }
    return context;
  }
}

/**
 * Test-only helper to drop the introspection cache between tests so cache
 * bleed doesn't cause false greens.
 */
export function _clearIntrospectionCacheForTests(): void {
  introspectionCache.clear();
}
