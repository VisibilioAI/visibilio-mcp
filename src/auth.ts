export interface OrganizationMembership {
  readonly id: number;
  readonly name: string;
  readonly role: string;
}

export interface AuthContext {
  readonly userId: number;
  readonly email: string;
  readonly name: string;
  readonly organizationId: number;
  readonly organizations: readonly OrganizationMembership[];
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
  credential: string;
  gatewayUrl: string;
  fetch?: typeof fetch;
}

interface MeResponse {
  user?: { id?: number; email?: string; name?: string };
  organizations?: Array<{ id?: number; name?: string; role?: string }>;
  default_organization_id?: number | null;
}

const CREDENTIAL_PREFIXES = ['vsk_', 'vat_'] as const;

export function isSupportedCredential(credential: string): boolean {
  return CREDENTIAL_PREFIXES.some((prefix) => credential.startsWith(prefix));
}

export class McpAuth {
  private readonly credential: string;
  private readonly gatewayUrl: string;
  private readonly fetchImpl: typeof fetch;
  private context: AuthContext | null = null;

  constructor(options: McpAuthOptions) {
    this.credential = options.credential;
    this.gatewayUrl = options.gatewayUrl.replace(/\/$/, '');
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
    if (!isSupportedCredential(this.credential)) {
      throw new AuthenticationError(
        'Unknown credential format — expected vsk_* (API key) or vat_* (OAuth access token)',
        401
      );
    }
    const response = await this.fetchImpl(`${this.gatewayUrl}/api/v2/auth/me`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${this.credential}`, Accept: 'application/json' },
    });
    if (!response.ok) {
      throw new AuthenticationError(describeFailure(response.status), failureStatus(response.status));
    }
    this.context = toAuthContext((await response.json()) as MeResponse);
    return this.context;
  }
}

function failureStatus(status: number): number {
  if (status === 401 || status === 403) return status;
  return 502;
}

function describeFailure(status: number): string {
  if (status === 401) return 'Credential rejected by Visibilio (401) — the key may be revoked or expired';
  if (status === 403) return 'Credential lacks the mcp scope (403) — generate a key with MCP access';
  return `Visibilio gateway unavailable while authenticating (HTTP ${status})`;
}

function toAuthContext(body: MeResponse): AuthContext {
  const organizations = (body.organizations ?? [])
    .filter((org) => typeof org.id === 'number')
    .map((org) => ({ id: org.id as number, name: org.name ?? '', role: org.role ?? 'member' }));
  const first = organizations[0];
  if (!first || typeof body.user?.id !== 'number') {
    throw new AuthenticationError('This user does not belong to any organization', 403);
  }
  const defaultId = body.default_organization_id ?? null;
  const organizationId = organizations.some((org) => org.id === defaultId)
    ? (defaultId as number)
    : first.id;
  return {
    userId: body.user.id,
    email: body.user.email ?? '',
    name: body.user.name ?? '',
    organizationId,
    organizations,
  };
}
