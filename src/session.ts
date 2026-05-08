import type { AuthContext } from './auth.js';
import type { TenantHeaders, VisibilioClient } from './client.js';

interface ActiveProject {
  readonly id: string;
  readonly name: string | null;
}

interface ActiveOrganization {
  readonly id: number;
  readonly name: string | null;
}

export class McpSession {
  private activeProject: ActiveProject | null;
  private activeOrganization: ActiveOrganization | null;

  constructor(
    public readonly auth: AuthContext,
    public readonly client: VisibilioClient
  ) {
    this.activeProject = auth.defaultProjectId ? { id: auth.defaultProjectId, name: null } : null;
    this.activeOrganization = null;
  }

  get organizationId(): number {
    return this.activeOrganization?.id ?? this.auth.organizationId;
  }

  get organizationName(): string | null {
    return this.activeOrganization?.name ?? null;
  }

  get userId(): number {
    return this.auth.userId;
  }

  get projectId(): string | null {
    return this.activeProject?.id ?? null;
  }

  get projectName(): string | null {
    return this.activeProject?.name ?? null;
  }

  setActiveProject(id: string, name: string | null = null): void {
    this.activeProject = { id, name };
  }

  setActiveOrganization(id: number, name: string | null = null): void {
    this.activeOrganization = { id, name };
    this.activeProject = null;
  }

  buildTenantHeaders(): TenantHeaders {
    const headers: Record<string, string> = {
      'X-User-Id': String(this.auth.userId),
      'X-Organization-Id': String(this.organizationId),
    };
    if (this.activeProject) headers['X-Project-Id'] = this.activeProject.id;
    return headers as unknown as TenantHeaders;
  }
}
