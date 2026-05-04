import type { McpSession } from '../session.js';
import { defineTool, stubTool, type ToolDescriptor } from './_define.js';
import { formatHttpError, optionalString, requireString } from './_format.js';

interface ContentPlanShape {
  id: string;
  name?: string | null;
  description?: string | null;
  status?: string | null;
}

function plansBasePath(session: McpSession): string | null {
  if (!session.projectId) return null;
  return `/api/v2/organizations/${session.organizationId}/projects/${session.projectId}/content-plans`;
}

const listContentPlans = defineTool('list_content_plans', async (_args, session) => {
  const base = plansBasePath(session);
  if (!base) return 'No active project. Use set_active_project first.';
  try {
    const body = (await session.client.gatewayGet(base)) as
      | { data?: { content_plans?: ContentPlanShape[] }; content_plans?: ContentPlanShape[] }
      | ContentPlanShape[];
    const plans = Array.isArray(body)
      ? body
      : (body.data?.content_plans ?? body.content_plans ?? []);
    if (plans.length === 0) return 'No content plans for this project yet.';
    const lines = plans.map((p) => `- ${p.name ?? 'Untitled'} (ID: ${p.id})`);
    return `Content Plans:\n${lines.join('\n')}`;
  } catch (err) {
    return formatHttpError('Error listing content plans', err);
  }
});

const createContentPlan = defineTool('create_content_plan', async (args, session) => {
  const base = plansBasePath(session);
  if (!base) return 'No active project. Use set_active_project first.';
  const name = requireString(args, 'name');
  const description = optionalString(args, 'description');
  const userInput = optionalString(args, 'user_input');
  const audienceIdsRaw = args.audience_ids;
  const audienceIds = Array.isArray(audienceIdsRaw)
    ? audienceIdsRaw.filter((v): v is string => typeof v === 'string')
    : [];
  try {
    const body = (await session.client.gatewayPost(base, {
      name,
      description,
      user_input: userInput,
      audience_ids: audienceIds,
    })) as { data?: ContentPlanShape; id?: string } & ContentPlanShape;
    const plan = body.data ?? body;
    return `Content plan created: ${plan.name ?? name} (ID: ${plan.id ?? '?'})`;
  } catch (err) {
    return formatHttpError('Error creating content plan', err);
  }
});

export const contentPlanTools: readonly ToolDescriptor[] = [
  listContentPlans,
  createContentPlan,
  stubTool('get_content_plan'),
  stubTool('generate_content_plan'),
  stubTool('get_content_plan_status'),
];
