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

export const organizationTools: readonly ToolDescriptor[] = [
  listProjects,
  getProject,
  setActiveProject,
];

export const _testHelpers = { fetchProjects, fetchProject };
