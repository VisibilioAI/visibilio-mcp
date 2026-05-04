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
  fetch?: typeof fetch;
}

export class McpAuth {
  private readonly apiKey: string;
  private readonly backendUrl: string;
  private readonly fetchImpl: typeof fetch;
  private context: AuthContext | null = null;

  constructor(options: McpAuthOptions) {
    this.apiKey = options.apiKey;
    this.backendUrl = options.backendUrl.replace(/\/$/, '');
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
    const url = `${this.backendUrl}/api/v2/auth/resolve-key`;
    const response = await this.fetchImpl(url, {
      method: 'GET',
      headers: { 'X-API-Key': this.apiKey, Accept: 'application/json' },
    });
    if (!response.ok) {
      throw new AuthenticationError(
        `Auth failed (${response.status}) — check VISIBILIO_API_KEY`,
        response.status
      );
    }
    const body = (await response.json()) as {
      user_id: number;
      organization_id: number;
      default_project_id: string | null;
      subscription_tier: string;
      scopes?: string[];
    };
    this.context = {
      userId: body.user_id,
      organizationId: body.organization_id,
      defaultProjectId: body.default_project_id,
      subscriptionTier: body.subscription_tier,
      scopes: body.scopes ?? ['mcp:read', 'mcp:write'],
    };
    return this.context;
  }
}
