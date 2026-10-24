import { z } from 'zod';
import {
  defineTool,
  destructive,
  mutating,
  optionalProductId,
  pick,
  readOnly,
  requireNumberArg,
  requireStringArg,
  unwrapData,
  type ToolDefinition,
} from './_define.js';
import { asArray, fields, line, listOrEmpty, nameOf, type Row } from './_format.js';

const CONTENT_TYPES = ['article', 'social_post', 'newsletter'] as const;
const BRIEF_STATUSES = ['draft', 'ready', 'in_progress', 'completed'] as const;
const LANGUAGES = ['en', 'bg', 'de'] as const;
const BRIEF_FIELDS = [
  'title',
  'content_type',
  'topic',
  'target_audience',
  'tone',
  'key_messages',
  'references',
  'notes',
  'channel_id',
  'language',
  'status',
] as const;

function briefLine(brief: Row): string {
  return line(nameOf(brief), 'brief_id', brief.id, [
    typeof brief.content_type === 'string' ? brief.content_type : undefined,
    typeof brief.status === 'string' ? brief.status : undefined,
    typeof brief.language === 'string' ? `language: ${brief.language}` : undefined,
  ]);
}

function describeBrief(brief: Row): string {
  return fields([
    ['Brief', brief.title],
    ['brief_id', brief.id],
    ['product_id', brief.product_id],
    ['status', brief.status],
    ['content_type', brief.content_type],
    ['topic', brief.topic],
    ['target_audience', brief.target_audience],
    ['tone', brief.tone],
    ['key_messages', brief.key_messages],
    ['references', brief.references],
    ['notes', brief.notes],
    ['channel_id', brief.channel_id],
    ['language', brief.language],
    ['generating_execution_id', brief.generating_execution_id],
  ]);
}

const listBriefs = defineTool({
  name: 'list_briefs',
  title: 'List briefs',
  description:
    'List content briefs in the organization, optionally filtered by status or content type.',
  inputSchema: {
    status: z.enum([...BRIEF_STATUSES, 'failed']).optional(),
    content_type: z.enum(CONTENT_TYPES).optional(),
  },
  annotations: readOnly,
  handler: async (args, session) => {
    const briefs = asArray<Row>(
      unwrapData(
        await session.client.get(
          '/api/v2/briefs',
          pick(args, ['status', 'content_type']) as Record<string, string>
        )
      )
    );
    return listOrEmpty(
      `Briefs (${briefs.length}):`,
      briefs.map(briefLine),
      'No briefs yet. Create one with create_brief.'
    );
  },
});

const getBrief = defineTool({
  name: 'get_brief',
  title: 'Get brief',
  description: 'Read one content brief in full.',
  inputSchema: { brief_id: z.number().int() },
  annotations: readOnly,
  handler: async (args, session) => {
    const briefId = requireNumberArg(args, 'brief_id');
    return describeBrief(unwrapData<Row>(await session.client.get(`/api/v2/briefs/${briefId}`)));
  },
});

const createBrief = defineTool({
  name: 'create_brief',
  title: 'Create brief',
  description:
    'Create a content brief (topic, audience, tone, key messages). Then call generate_from_brief to have Visibilio write the piece.',
  inputSchema: {
    title: z.string().min(1),
    content_type: z.enum(CONTENT_TYPES).optional().describe('Default article'),
    topic: z.string().optional(),
    target_audience: z.string().optional(),
    tone: z.string().optional(),
    key_messages: z.array(z.string()).optional(),
    references: z.array(z.string()).optional().describe('URLs or sources to draw on'),
    notes: z.string().optional(),
    channel_id: z.number().int().optional(),
    language: z.enum(LANGUAGES).optional(),
    product_id: z.number().int().optional().describe('Defaults to the active product'),
  },
  annotations: mutating,
  handler: async (args, session) => {
    requireStringArg(args, 'title');
    const productId = optionalProductId(args, session);
    const brief = unwrapData<Row>(
      await session.client.post('/api/v2/briefs', {
        ...pick(
          args,
          BRIEF_FIELDS.filter((f) => f !== 'status')
        ),
        ...(productId !== undefined ? { product_id: productId } : {}),
      })
    );
    return `Brief created.\n${describeBrief(brief)}\nNext: generate_from_brief(brief_id: ${String(brief.id)}).`;
  },
});

const updateBrief = defineTool({
  name: 'update_brief',
  title: 'Update brief',
  description:
    'Change a brief: text fields, status (draft/ready/in_progress/completed), channel or language. Only passed fields change.',
  inputSchema: {
    brief_id: z.number().int(),
    title: z.string().optional(),
    content_type: z.enum(CONTENT_TYPES).optional(),
    topic: z.string().optional(),
    target_audience: z.string().optional(),
    tone: z.string().optional(),
    key_messages: z.array(z.string()).optional(),
    references: z.array(z.string()).optional(),
    notes: z.string().optional(),
    channel_id: z.number().int().nullable().optional(),
    language: z.enum(LANGUAGES).nullable().optional(),
    status: z.enum(BRIEF_STATUSES).optional(),
  },
  annotations: mutating,
  handler: async (args, session) => {
    const briefId = requireNumberArg(args, 'brief_id');
    const brief = unwrapData<Row>(
      await session.client.put(`/api/v2/briefs/${briefId}`, pick(args, BRIEF_FIELDS))
    );
    return `Brief updated.\n${describeBrief(brief)}`;
  },
});

const deleteBrief = defineTool({
  name: 'delete_brief',
  title: 'Delete brief',
  description: 'Delete a brief. Content items generated from it are kept.',
  inputSchema: { brief_id: z.number().int() },
  annotations: destructive,
  handler: async (args, session) => {
    const briefId = requireNumberArg(args, 'brief_id');
    await session.client.delete(`/api/v2/briefs/${briefId}`);
    return `Brief ${briefId} deleted.`;
  },
});

const generateFromBrief = defineTool({
  name: 'generate_from_brief',
  title: 'Generate from brief',
  description:
    'Start AI generation for a brief (needs a topic or title). Returns an execution id; follow it with get_workflow_status, then save the result with create_content_item(type, source_execution_id).',
  inputSchema: { brief_id: z.number().int() },
  annotations: mutating,
  handler: async (args, session) => {
    const briefId = requireNumberArg(args, 'brief_id');
    const result = unwrapData<Row>(await session.client.post(`/api/v2/briefs/${briefId}/generate`));
    return [
      `Generation started for brief ${briefId}: execution_id ${String(result.execution_id)} (status ${String(result.status)}).`,
      `Call get_workflow_status(execution_id: "${String(result.execution_id)}") to follow it; it returns at once, so call it again while it reports the run is still going (an article usually takes 4-7 minutes, a post about 2).`,
    ].join('\n');
  },
});

const listBriefContentItems = defineTool({
  name: 'list_brief_content_items',
  title: 'List brief content items',
  description: 'List the content items linked to a brief.',
  inputSchema: { brief_id: z.number().int() },
  annotations: readOnly,
  handler: async (args, session) => {
    const briefId = requireNumberArg(args, 'brief_id');
    const links = asArray<Row>(
      unwrapData(await session.client.get(`/api/v2/briefs/${briefId}/content-items`))
    );
    return listOrEmpty(
      `Content items linked to brief ${briefId}:`,
      links.map((l) => {
        const item = (l.content_item as Row | null) ?? {};
        return line(nameOf(item), 'content_item_id', item.id ?? l.content_item_id, [
          typeof item.type === 'string' ? item.type : undefined,
          typeof item.status === 'string' ? item.status : undefined,
        ]);
      }),
      'No content items linked to this brief yet.'
    );
  },
});

export const briefTools: readonly ToolDefinition[] = [
  listBriefs,
  getBrief,
  createBrief,
  updateBrief,
  deleteBrief,
  generateFromBrief,
  listBriefContentItems,
];
