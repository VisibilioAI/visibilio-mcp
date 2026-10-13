import { z } from 'zod';
import {
  defineTool,
  destructive,
  mutating,
  optionalProductId,
  readOnly,
  requireNumberArg,
  requireStringArg,
  resolveProductId,
  type ToolDefinition,
} from './_define.js';
import { asArray, line, listOrEmpty, nameOf, truncate, type Row } from './_format.js';

const listAudiences = defineTool({
  name: 'list_audiences',
  title: 'List audiences',
  description:
    'List the audience segments of a product (id, name, description, whether a persona exists). Audience ids are used by create_content_item, start_workflow and repurpose_content_item.',
  inputSchema: {
    product_id: z.number().int().optional().describe('Defaults to the active product'),
  },
  annotations: readOnly,
  handler: async (args, session) => {
    const productId = optionalProductId(args, session);
    const body = (await session.client.get(
      '/api/v2/audiences',
      productId !== undefined ? { product_id: productId } : undefined
    )) as { audiences?: Row[] };
    const audiences = asArray<Row>(body.audiences);
    return listOrEmpty(
      `Audiences (${audiences.length}):`,
      audiences.map((a) =>
        line(nameOf(a), 'audience_id', a.id, [
          typeof a.description === 'string' ? truncate(a.description, 120) : undefined,
          a.has_persona === true ? 'persona: yes' : undefined,
        ])
      ),
      'No audiences yet. Create one with create_audience or run onboarding in the app.'
    );
  },
});

const createAudience = defineTool({
  name: 'create_audience',
  title: 'Create audience',
  description:
    'Add an audience segment to a product with a name and a description of who they are and what they need.',
  inputSchema: {
    product_id: z.number().int().optional(),
    name: z.string().min(1),
    description: z.string().min(1),
  },
  annotations: mutating,
  handler: async (args, session) => {
    const productId = resolveProductId(args, session);
    const body = (await session.client.post('/api/v2/audiences', {
      name: requireStringArg(args, 'name'),
      description: requireStringArg(args, 'description'),
      product_id: productId,
    })) as { audience?: Row };
    const audience = body.audience ?? (body as Row);
    return `Audience created.\n${line(nameOf(audience), 'audience_id', audience.id, [typeof audience.description === 'string' ? audience.description : undefined])}`;
  },
});

const deleteAudience = defineTool({
  name: 'delete_audience',
  title: 'Delete audience',
  description:
    'Delete an audience segment and its persona. Content already written for it is kept.',
  inputSchema: { audience_id: z.number().int() },
  annotations: destructive,
  handler: async (args, session) => {
    const audienceId = requireNumberArg(args, 'audience_id');
    await session.client.delete(`/api/v2/audiences/${audienceId}`);
    return `Audience ${audienceId} deleted.`;
  },
});

export const audienceTools: readonly ToolDefinition[] = [
  listAudiences,
  createAudience,
  deleteAudience,
];
