import { defineResource, type ResourceDescriptor } from './_define.js';
import { formatHttpError } from '../tools/_format.js';

const currentOrganization = defineResource('current_organization', async (session) => {
  const ctx = session.auth;
  return [
    `Organization ID: ${ctx.organizationId}`,
    `User ID: ${ctx.userId}`,
    `Subscription Tier: ${ctx.subscriptionTier}`,
    `Default Project ID: ${ctx.defaultProjectId ?? '(none)'}`,
  ].join('\n');
});

const currentProject = defineResource('current_project', async (session) => {
  if (!session.projectId) {
    return 'No active project. Use set_active_project to choose one.';
  }
  try {
    const path = `/api/v2/organizations/${session.organizationId}/projects/${session.projectId}`;
    const body = (await session.client.gatewayGet(path)) as
      | { data?: { id: string; name?: string; status?: string } }
      | { id: string; name?: string; status?: string };
    const proj =
      'data' in body && body.data
        ? body.data
        : (body as { id: string; name?: string; status?: string });
    return [
      `Project: ${proj.name ?? 'Unnamed'}`,
      `ID: ${proj.id}`,
      proj.status ? `Status: ${proj.status}` : null,
    ]
      .filter((s): s is string => s !== null)
      .join('\n');
  } catch (err) {
    return formatHttpError(`Could not fetch project ${session.projectId}`, err);
  }
});

export const contextResources: readonly ResourceDescriptor[] = [
  currentOrganization,
  currentProject,
];
