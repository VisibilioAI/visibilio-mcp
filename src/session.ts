import type { AuthContext, OrganizationMembership } from './auth.js';
import type { VisibilioClient } from './client.js';

export interface ActiveProduct {
  readonly id: number;
  readonly name: string | null;
}

/** What a session remembers between calls; restored into the next session of the same credential. */
export interface SessionContext {
  readonly organizationId: number;
  readonly product: ActiveProduct | null;
}

interface McpSessionOptions {
  readonly initialContext?: SessionContext;
  readonly onContextChange?: (context: SessionContext) => Promise<void> | void;
}

export class McpSession {
  private activeOrganizationId: number;
  private activeProduct: ActiveProduct | null = null;
  private readonly onContextChange: (context: SessionContext) => Promise<void> | void;

  constructor(
    public readonly auth: AuthContext,
    public readonly client: VisibilioClient,
    options: McpSessionOptions = {}
  ) {
    this.onContextChange = options.onContextChange ?? (() => undefined);
    const restored = options.initialContext;
    const canRestore =
      restored !== undefined &&
      auth.organizations.some((org) => org.id === restored.organizationId);
    this.activeOrganizationId = canRestore ? restored.organizationId : auth.organizationId;
    this.activeProduct = canRestore ? restored.product : null;
    client.setActiveOrganization(this.activeOrganizationId);
  }

  get context(): SessionContext {
    return { organizationId: this.activeOrganizationId, product: this.activeProduct };
  }

  get userId(): number {
    return this.auth.userId;
  }

  get organizationId(): number {
    return this.activeOrganizationId;
  }

  get organization(): OrganizationMembership | undefined {
    return this.auth.organizations.find((org) => org.id === this.activeOrganizationId);
  }

  get organizations(): readonly OrganizationMembership[] {
    return this.auth.organizations;
  }

  get product(): ActiveProduct | null {
    return this.activeProduct;
  }

  get productId(): number | null {
    return this.activeProduct?.id ?? null;
  }

  async setActiveOrganization(id: number): Promise<OrganizationMembership> {
    const membership = this.auth.organizations.find((org) => org.id === id);
    if (!membership) {
      throw new Error(
        `You are not a member of organization ${id}. Call list_organizations to see your organizations.`
      );
    }
    this.activeOrganizationId = id;
    this.activeProduct = null;
    this.client.setActiveOrganization(id);
    await this.onContextChange(this.context);
    return membership;
  }

  async setActiveProduct(id: number, name: string | null = null): Promise<void> {
    this.activeProduct = { id, name };
    await this.onContextChange(this.context);
  }
}
