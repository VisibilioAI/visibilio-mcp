import type { AuthContext, OrganizationMembership } from './auth.js';
import type { VisibilioClient } from './client.js';

export interface ActiveProduct {
  readonly id: number;
  readonly name: string | null;
}

export class McpSession {
  private activeOrganizationId: number;
  private activeProduct: ActiveProduct | null = null;

  constructor(
    public readonly auth: AuthContext,
    public readonly client: VisibilioClient
  ) {
    this.activeOrganizationId = auth.organizationId;
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

  setActiveOrganization(id: number): OrganizationMembership {
    const membership = this.auth.organizations.find((org) => org.id === id);
    if (!membership) {
      throw new Error(
        `You are not a member of organization ${id}. Call list_organizations to see your organizations.`
      );
    }
    this.activeOrganizationId = id;
    this.activeProduct = null;
    return membership;
  }

  setActiveProduct(id: number, name: string | null = null): void {
    this.activeProduct = { id, name };
  }
}
