import type { McpSession } from '../session.js';
import { defineTool, type ToolDescriptor } from './_define.js';
import { formatHttpError, requireString } from './_format.js';

interface ProjectShape {
  id: string;
  name?: string | null;
  status?: string | null;
}

async function fetchProjects(session: McpSession): Promise<ProjectShape[]> {
  const path = `/api/v2/organizations/${session.organizationId}/projects`;
  const body = (await session.client.gatewayGet(path)) as
    | { data?: { projects?: ProjectShape[] }; projects?: ProjectShape[] }
    | ProjectShape[];
  if (Array.isArray(body)) return body;
  return body.data?.projects ?? body.projects ?? [];
}

async function fetchProject(session: McpSession, projectId: string): Promise<ProjectShape | null> {
  const path = `/api/v2/organizations/${session.organizationId}/projects/${projectId}`;
  try {
    const body = (await session.client.gatewayGet(path)) as { data?: ProjectShape } | ProjectShape;
    if ('data' in body && body.data) return body.data;
    return body as ProjectShape;
  } catch {
    return null;
  }
}

const listProjects = defineTool('list_projects', async (_args, session) => {
  try {
    const projects = await fetchProjects(session);
    if (projects.length === 0) return 'No projects found in this organization.';
    const lines = projects.map((p) => `- ${p.name ?? 'Unnamed'} (ID: ${p.id})`);
    return `Projects:\n${lines.join('\n')}`;
  } catch (err) {
    return formatHttpError('Error listing projects', err);
  }
});

const getProject = defineTool('get_project', async (args, session) => {
  const projectId = requireString(args, 'project_id');
  const project = await fetchProject(session, projectId);
  if (!project) return `Error: Could not find project ${projectId}.`;
  const lines = [
    `Project: ${project.name ?? 'Unnamed'}`,
    `ID: ${project.id}`,
    project.status ? `Status: ${project.status}` : null,
  ].filter((l): l is string => l !== null);
  return lines.join('\n');
});

const setActiveProject = defineTool('set_active_project', async (args, session) => {
  const projectId = requireString(args, 'project_id');
  const project = await fetchProject(session, projectId);
  if (!project) {
    return `Error: Could not find project ${projectId}. Use list_projects to see available projects.`;
  }
  session.setActiveProject(project.id, project.name ?? null);
  return `Active project set: ${project.name ?? 'Unnamed'} (ID: ${project.id}). Subsequent calls are scoped to this project.`;
});

const setActiveOrganization = defineTool('set_active_organization', async (args, session) => {
  const raw = args.organization_id;
  if (raw === undefined || raw === null || raw === '') {
    return 'Error: organization_id is required. Provide the numeric ID of an organization you belong to.';
  }
  const idAsNumber = Number(raw);
  if (!Number.isFinite(idAsNumber) || !Number.isInteger(idAsNumber)) {
    return `Error: organization_id must be numeric (got "${String(raw)}").`;
  }
  session.setActiveOrganization(idAsNumber, null);
  return `Active organization set to ${idAsNumber}. The active project was cleared; use set_active_project to pick a project inside this organization. If you don't have access to this organization, subsequent calls will return a 403.`;
});

export const organizationTools: readonly ToolDescriptor[] = [
  listProjects,
  getProject,
  setActiveProject,
  setActiveOrganization,
];

export const _testHelpers = { fetchProjects, fetchProject };
