import { z } from 'zod';
import type { McpSession } from '../session.js';
import {
  defineTool,
  destructive,
  mutating,
  pick,
  readOnly,
  requireNumberArg,
  resolveProductId,
  stringArg,
  ToolError,
  unwrapData,
  type ToolDefinition,
} from './_define.js';
import { asArray, fields, line, listOrEmpty, nameOf, truncate, type Row } from './_format.js';
import { pickPiece, piecesOf } from './_run.js';
import { publicationSyncState, reconcileChangedFields } from './publication-sync.js';

const CONTENT_TYPES = ['article', 'social_post', 'newsletter'] as const;
const STATUSES = [
  'draft',
  'review',
  'changes_requested',
  'approved',
  'scheduled',
  'published',
  'archived',
] as const;
export const LANGUAGES = ['en', 'bg', 'de'] as const;
const REMIX_STRATEGIES = ['adapt', 'split', 'expand', 'summarize', 'remix'] as const;

const EDITORIAL_FIELDS = [
  'title',
  'subtitle',
  'body',
  'excerpt',
  'status',
  'platform',
  'tags',
  'categories',
  'seo_meta',
  'canonical_url',
  'body_format',
  'audience_ids',
  'featured_image_url',
  'author_name',
  'edit_prompt',
] as const;

function itemLine(item: Row): string {
  return line(nameOf(item), 'content_item_id', item.id, [
    typeof item.type === 'string' ? item.type : undefined,
    typeof item.status === 'string' ? item.status : undefined,
    typeof item.platform === 'string' ? `platform: ${item.platform}` : undefined,
    typeof item.language === 'string' ? `language: ${item.language}` : undefined,
    typeof item.updated_at === 'string' ? `updated: ${item.updated_at.slice(0, 10)}` : undefined,
  ]);
}

function describeItem(item: Row, includeBody: boolean): string {
  const audiences = asArray<Row>(item.audiences)
    .map((a) => a.name)
    .filter(Boolean);
  const head = fields([
    ['Title', item.title],
    ['content_item_id', item.id],
    ['product_id', item.product_id],
    ['type', item.type],
    ['status', item.status],
    ['platform', item.platform],
    ['language', item.language],
    ['subtitle', item.subtitle],
    ['excerpt', item.excerpt],
    ['tags', item.tags],
    ['categories', item.categories],
    ['audiences', audiences],
    ['seo_meta', item.seo_meta],
    ['canonical_url', item.canonical_url],
    ['featured_image_url', item.featured_image_url],
    ['author_name', item.author_name],
    ['body_format', item.body_format],
    ['version', item.version],
    ['updated_at', item.updated_at],
  ]);
  if (!includeBody) return head;
  return `${head}\n\nBody:\n${String(item.body ?? '')}`;
}

export async function fetchItem(session: McpSession, itemId: number): Promise<Row> {
  return unwrapData<Row>(await session.client.get(`/api/v2/content-items/${itemId}`));
}

async function publicationDriftLine(session: McpSession, item: Row): Promise<string | null> {
  if (item.status !== 'published') return null;
  try {
    const hubs = asArray<Row>(unwrapData(await session.client.get('/api/v2/content-hubs')));
    const hub = hubs.find((h) => h.is_active === true) ?? hubs[0];
    if (!hub) return null;
    const publications = asArray<Row>(
      unwrapData(await session.client.get(`/api/v2/content-hubs/${String(hub.id)}/publications`))
    );
    const publication = publications.find((p) => String(p.content_item_id) === String(item.id));
    if (!publication) return null;
    const publishedVersion = publication.published_version;
    const currentVersion = item.version;
    const state = publicationSyncState({
      publishedVersion: typeof publishedVersion === 'number' ? publishedVersion : null,
      currentVersion: typeof currentVersion === 'number' ? currentVersion : null,
    });
    if (state !== 'drifted') return null;
    return `\nPublication: Published, changes not live — the live hub page is behind the current draft (published version ${String(publishedVersion)}, current version ${String(currentVersion)}).`;
  } catch {
    return null;
  }
}

const listContentItems = defineTool({
  name: 'list_content_items',
  title: 'List content items',
  description:
    'List content items (articles, social posts, newsletters) of a product with optional filters. Returns ids, titles, type, status and platform; use get_content_item for the body.',
  inputSchema: {
    product_id: z.number().int().optional().describe('Defaults to the active product'),
    type: z.enum(CONTENT_TYPES).optional(),
    status: z.enum(STATUSES).optional().describe('Omit to list everything except archived'),
    platform: z.string().optional(),
    search: z.string().optional().describe('Case-insensitive match on title or body'),
    limit: z.number().int().min(1).max(500).optional(),
    offset: z.number().int().min(0).optional(),
  },
  annotations: readOnly,
  handler: async (args, session) => {
    const productId = resolveProductId(args, session);
    const body = await session.client.get(
      `/api/v2/products/${productId}/content-items`,
      pick(args, ['type', 'status', 'platform', 'search', 'limit', 'offset']) as Record<
        string,
        string | number
      >
    );
    const items = asArray<Row>(unwrapData(body));
    return listOrEmpty(
      `Content items (${items.length}):`,
      items.map(itemLine),
      'No content items match. Try a broader filter, or create one with create_content_item.'
    );
  },
});

const getContentItem = defineTool({
  name: 'get_content_item',
  title: 'Get content item',
  description: 'Read one content item in full, including its body, SEO meta, audiences and status.',
  inputSchema: {
    content_item_id: z.number().int(),
    include_body: z.boolean().optional().describe('Default true'),
  },
  annotations: readOnly,
  handler: async (args, session) => {
    const item = await fetchItem(session, requireNumberArg(args, 'content_item_id'));
    const described = describeItem(item, args.include_body !== false);
    const drift = await publicationDriftLine(session, item);
    return drift ? `${described}${drift}` : described;
  },
});

const GENERATED_FIELDS = [
  'title',
  'body',
  'body_format',
  'platform',
  'excerpt',
  'subtitle',
  'seo_meta',
  'aeo_assets',
] as const;

async function generatedFieldsOfRun(
  session: McpSession,
  executionId: string,
  args: Record<string, unknown>
): Promise<Row> {
  const status = (await session.client.get(`/api/v2/workflow/${executionId}/status`)) as Row;
  const pieces = piecesOf(status.final_output);
  const piece = pickPiece(pieces, { title: args.title, platform: args.platform });
  if (!piece && pieces.length > 1 && args.body === undefined) {
    const choices = pieces.map((p) => `${String(p.platform)}: "${String(p.title)}"`).join('; ');
    throw new ToolError(
      `Run ${executionId} produced ${pieces.length} pieces (${choices}). Pass the title or platform of the one to save.`
    );
  }
  if (!piece) return {};
  return Object.fromEntries(
    GENERATED_FIELDS.filter(
      (key) => args[key] === undefined && piece[key] !== undefined && piece[key] !== null
    ).map((key) => [key, piece[key]])
  );
}

const createContentItem = defineTool({
  name: 'create_content_item',
  title: 'Create content item',
  description:
    'Create a content item in a product as a draft. Use it to save text you wrote, or to save a generated workflow result: pass type and source_execution_id, and the title, text, SEO meta, FAQ and summary come from the run unless you pass your own (idempotent per execution).',
  inputSchema: {
    product_id: z.number().int().optional().describe('Defaults to the active product'),
    type: z.enum(CONTENT_TYPES),
    title: z.string().optional(),
    body: z.string().optional().describe('HTML for articles, plain text for social posts'),
    platform: z.string().optional().describe('e.g. blog, linkedin, x, facebook, instagram'),
    language: z.enum(LANGUAGES).optional(),
    tags: z.array(z.string()).optional(),
    categories: z.array(z.string()).optional(),
    audience_ids: z.array(z.string()).optional().describe('Audience ids from list_audiences'),
    seo_meta: z
      .object({
        description: z.string().optional(),
        keywords: z.array(z.string()).optional(),
        suggested_slug: z.string().optional(),
      })
      .optional(),
    subtitle: z.string().optional(),
    excerpt: z.string().optional(),
    body_format: z.enum(['markdown', 'html', 'plain']).optional(),
    source_execution_id: z
      .string()
      .optional()
      .describe('Workflow execution id whose output this item saves'),
  },
  annotations: mutating,
  handler: async (args, session) => {
    const productId = resolveProductId(args, session);
    const payload = pick(args, [
      'type',
      'title',
      'body',
      'platform',
      'language',
      'tags',
      'categories',
      'audience_ids',
      'seo_meta',
      'subtitle',
      'excerpt',
      'body_format',
      'source_execution_id',
    ]);
    const sourceExecutionId = stringArg(args, 'source_execution_id');
    const generated = sourceExecutionId
      ? await generatedFieldsOfRun(session, sourceExecutionId, args)
      : {};
    const item = unwrapData<Row>(
      await session.client.post(`/api/v2/products/${productId}/content-items`, {
        ...payload,
        ...generated,
      })
    );
    return `Content item created.\n${describeItem(item, false)}`;
  },
});

const updateContentItem = defineTool({
  name: 'update_content_item',
  title: 'Update content item',
  description:
    'Edit a content item: text, status, platform, tags, SEO meta, audiences. Only the fields you pass change; every change is versioned. Status moves published→draft and archived→published are rejected.',
  inputSchema: {
    content_item_id: z.number().int(),
    title: z.string().optional(),
    subtitle: z.string().optional(),
    body: z.string().optional(),
    excerpt: z.string().optional(),
    status: z.enum(STATUSES).optional(),
    platform: z.string().optional(),
    tags: z.array(z.string()).optional(),
    categories: z.array(z.string()).optional(),
    seo_meta: z
      .object({
        description: z.string().optional(),
        keywords: z.array(z.string()).optional(),
        suggested_slug: z.string().optional(),
      })
      .optional(),
    canonical_url: z.string().optional(),
    body_format: z.enum(['markdown', 'html', 'plain']).optional(),
    audience_ids: z.array(z.string()).optional().describe('Replaces the audience set'),
    featured_image_url: z.string().optional(),
    author_name: z.string().optional(),
    edit_prompt: z
      .string()
      .optional()
      .describe('Short note on what changed and why (stored with the version)'),
  },
  annotations: mutating,
  handler: async (args, session) => {
    const itemId = requireNumberArg(args, 'content_item_id');
    const requested = pick(args, EDITORIAL_FIELDS);
    const payload = { ...requested, created_by: 'agent' };
    const before = await fetchItem(session, itemId);
    const body = (await session.client.put(`/api/v2/content-items/${itemId}`, payload)) as {
      data?: Row;
      changed_fields?: string[];
    };
    const item = body.data ?? (body as Row);
    const changedFields = reconcileChangedFields({
      before,
      after: item,
      requested: Object.keys(requested),
      versionChangedFields: body.changed_fields,
    });
    const changed = changedFields.length ? changedFields.join(', ') : 'nothing (no differences)';
    return `Updated: ${changed}.\n${describeItem(item, false)}`;
  },
});

const deleteContentItem = defineTool({
  name: 'delete_content_item',
  title: 'Delete content item',
  description:
    'Permanently delete a content item. Fails with 409 if it is still published on a hub; unpublish first.',
  inputSchema: { content_item_id: z.number().int() },
  annotations: destructive,
  handler: async (args, session) => {
    const itemId = requireNumberArg(args, 'content_item_id');
    await session.client.delete(`/api/v2/content-items/${itemId}`);
    return `Content item ${itemId} deleted.`;
  },
});

const duplicateContentItem = defineTool({
  name: 'duplicate_content_item',
  title: 'Duplicate content item',
  description: 'Clone a content item as a new draft titled "<title> (Copy)".',
  inputSchema: { content_item_id: z.number().int() },
  annotations: mutating,
  handler: async (args, session) => {
    const itemId = requireNumberArg(args, 'content_item_id');
    const copy = unwrapData<Row>(
      await session.client.post(`/api/v2/content-items/${itemId}/duplicate`)
    );
    return `Duplicated.\n${itemLine(copy)}`;
  },
});

const listContentItemVersions = defineTool({
  name: 'list_content_item_versions',
  title: 'List content item versions',
  description:
    'Show the version history of a content item (who changed what, when). Use restore_content_item_version to roll back.',
  inputSchema: {
    content_item_id: z.number().int(),
    limit: z.number().int().min(1).max(200).optional(),
  },
  annotations: readOnly,
  handler: async (args, session) => {
    const itemId = requireNumberArg(args, 'content_item_id');
    const versions = asArray<Row>(
      unwrapData(
        await session.client.get(
          `/api/v2/content-items/${itemId}/versions`,
          pick(args, ['limit']) as Record<string, number>
        )
      )
    );
    return listOrEmpty(
      `Versions of content item ${itemId}:`,
      versions.map((v) =>
        line(typeof v.title === 'string' ? v.title : 'Version', 'version_id', v.id, [
          typeof v.created_at === 'string' ? v.created_at : undefined,
          typeof v.created_by === 'string' ? `by ${v.created_by}` : undefined,
          Array.isArray(v.changed_fields) && v.changed_fields.length
            ? `changed: ${(v.changed_fields as string[]).join(', ')}`
            : undefined,
          typeof v.edit_prompt === 'string' && v.edit_prompt
            ? `note: ${truncate(v.edit_prompt, 80)}`
            : undefined,
        ])
      ),
      'No versions recorded yet.'
    );
  },
});

const restoreContentItemVersion = defineTool({
  name: 'restore_content_item_version',
  title: 'Restore content item version',
  description:
    'Roll a content item back to an earlier version (from list_content_item_versions). Creates a new version; nothing is lost.',
  inputSchema: { content_item_id: z.number().int(), version_id: z.number().int() },
  annotations: mutating,
  handler: async (args, session) => {
    const itemId = requireNumberArg(args, 'content_item_id');
    const versionId = requireNumberArg(args, 'version_id');
    const item = unwrapData<Row>(
      await session.client.post(`/api/v2/content-items/${itemId}/restore`, {
        version_id: versionId,
      })
    );
    return `Restored version ${versionId}.\n${describeItem(item, false)}`;
  },
});

const generateSeoMeta = defineTool({
  name: 'generate_seo_meta',
  title: 'Generate SEO meta',
  description:
    'Generate an SEO description, keywords and slug (and optional AEO summary bullets and FAQs) for a content item. Nothing is saved: apply the result with update_content_item.',
  inputSchema: {
    content_item_id: z.number().int(),
    body: z.string().optional().describe('Defaults to the stored body'),
    title: z.string().optional().describe('Defaults to the stored title'),
    keywords: z.array(z.string()).optional(),
    include_aeo_assets: z.boolean().optional(),
  },
  annotations: mutating,
  handler: async (args, session) => {
    const itemId = requireNumberArg(args, 'content_item_id');
    const stored = stringArg(args, 'body') ? null : await fetchItem(session, itemId);
    const payload = {
      body: stringArg(args, 'body') ?? String(stored?.body ?? ''),
      title: stringArg(args, 'title') ?? (stored ? String(stored.title ?? '') : undefined),
      ...pick(args, ['keywords', 'include_aeo_assets']),
    };
    const result = unwrapData<Row>(
      await session.client.post(`/api/v2/content-items/${itemId}/seo-meta`, payload)
    );
    return [
      'Suggested SEO meta (not saved yet):',
      JSON.stringify(result, null, 2),
      'Apply with update_content_item(content_item_id, seo_meta: {...}).',
    ].join('\n');
  },
});

const validateBrandVoice = defineTool({
  name: 'validate_brand_voice',
  title: 'Validate brand voice',
  description:
    'Score a text against the product brand voice: on-brand verdict, tone and vocabulary alignment, concrete issues with suggested fixes. Defaults to the stored body.',
  inputSchema: { content_item_id: z.number().int(), content: z.string().optional() },
  annotations: readOnly,
  handler: async (args, session) => {
    const itemId = requireNumberArg(args, 'content_item_id');
    const content =
      stringArg(args, 'content') ?? String((await fetchItem(session, itemId)).body ?? '');
    const result = unwrapData<Row>(
      await session.client.post(`/api/v2/content-items/${itemId}/voice-validate`, { content })
    );
    return JSON.stringify(result, null, 2);
  },
});

const repurposeContentItem = defineTool({
  name: 'repurpose_content_item',
  title: 'Repurpose content item',
  description:
    'Create platform-specific variants of a content item (e.g. a LinkedIn post and an X thread from an article). Returns a job id at once; follow it with get_generation_job_status until it completes, then the variants are saved as drafts automatically. Retrying the same request never generates a second set of variants.',
  inputSchema: {
    content_item_id: z.number().int(),
    targets: z
      .array(
        z.object({
          platform: z.string().describe('linkedin, x, facebook, instagram, blog, newsletter …'),
          content_type: z.enum(CONTENT_TYPES),
          remix_strategy: z.enum(REMIX_STRATEGIES),
          instructions: z.string().optional(),
        })
      )
      .min(1),
    additional_context: z.string().optional(),
    language: z.enum(LANGUAGES).optional(),
  },
  annotations: mutating,
  handler: async (args, session) => {
    const itemId = requireNumberArg(args, 'content_item_id');
    const started = (await session.client.post(
      `/api/v2/content-items/${itemId}/repurpose-async`,
      pick(args, ['targets', 'additional_context', 'language'])
    )) as { job_id?: number | string; status?: string };
    const jobId = String(started.job_id ?? '');
    return `Repurpose started: job ${jobId} (${String(started.status ?? 'running')}). Call get_generation_job_status(job_id: "${jobId}") until it completes; the variants are saved as drafts automatically.`;
  },
});

const quickRepurposeContentItem = defineTool({
  name: 'quick_repurpose_content_item',
  title: 'Quick repurpose',
  description:
    'Repurpose a content item to the distribution channels configured in the product content strategy, in one call. Returns the ids of the created drafts.',
  inputSchema: {
    content_item_id: z.number().int(),
    additional_context: z.string().optional(),
    schedule_mode: z.enum(['draft', 'auto']).optional(),
    language: z.enum(LANGUAGES).optional(),
  },
  annotations: mutating,
  handler: async (args, session) => {
    const itemId = requireNumberArg(args, 'content_item_id');
    const result = unwrapData<Row>(
      await session.client.post(
        `/api/v2/content-items/${itemId}/quick-repurpose`,
        pick(args, ['additional_context', 'schedule_mode', 'language'])
      )
    );
    const ids = asArray<string | number>(result.created_content_item_ids);
    return `Created ${ids.length} draft(s): ${ids.map((id) => `content_item_id: ${id}`).join(', ') || 'none'}.`;
  },
});

const translateContentItem = defineTool({
  name: 'translate_content_item',
  title: 'Translate content item',
  description:
    'Translate a content item into another supported language as a linked draft variant (requires multi-language to be enabled for the product).',
  inputSchema: { content_item_id: z.number().int(), target_language: z.enum(LANGUAGES) },
  annotations: mutating,
  handler: async (args, session) => {
    const itemId = requireNumberArg(args, 'content_item_id');
    const item = unwrapData<Row>(
      await session.client.post(
        `/api/v2/content-items/${itemId}/translate`,
        pick(args, ['target_language'])
      )
    );
    return `Translation created.\n${itemLine(item)}`;
  },
});

const generateCoverImage = defineTool({
  name: 'generate_cover_image',
  title: 'Generate cover image',
  description:
    'Generate an AI cover image for a content item in the product illustration style and attach it as the featured image. Returns a job id at once; follow it with get_generation_job_status until it completes (the cover attaches to the item automatically). Retrying the same request never generates a second cover.',
  inputSchema: {
    content_item_id: z.number().int(),
    prompt: z.string().max(500).optional().describe('Optional art direction'),
    user_initiated: z.boolean().optional().describe('Set true to replace a user-uploaded cover'),
  },
  annotations: mutating,
  handler: async (args, session) => {
    const itemId = requireNumberArg(args, 'content_item_id');
    const started = (await session.client.post(
      `/api/v2/content-items/${itemId}/generate-cover-async`,
      pick(args, ['prompt', 'user_initiated'])
    )) as { job_id?: number | string; status?: string };
    const jobId = String(started.job_id ?? '');
    return `Cover generation started: job ${jobId} (${String(started.status ?? 'running')}). Call get_generation_job_status(job_id: "${jobId}") until it completes; the cover attaches to the content item automatically.`;
  },
});

const GENERATION_JOB_TERMINAL_STATUSES = ['completed', 'partial_failed', 'failed'] as const;

const getGenerationJobStatus = defineTool({
  name: 'get_generation_job_status',
  title: 'Get generation job status',
  description:
    'Check an async generation job (for example a cover image). Returns the current status at once; while it is still running, call again shortly. A status read is idempotent, so a retry never duplicates work.',
  inputSchema: {
    job_id: z
      .union([z.number().int(), z.string()])
      .describe('The job id returned when the job started'),
  },
  annotations: readOnly,
  handler: async (args, session) => {
    const jobId = String(args.job_id ?? '');
    const job = unwrapData<Row>(await session.client.get(`/api/v2/generation-jobs/${jobId}`));
    const status = String(job.status ?? '');
    const head = fields([
      ['job_id', job.job_id ?? jobId],
      ['kind', job.kind],
      ['status', job.status],
      ['error', job.error],
    ]);
    if (!(GENERATION_JOB_TERMINAL_STATUSES as readonly string[]).includes(status)) {
      return `${head}\nStill running; call get_generation_job_status again shortly.`;
    }
    if (status === 'completed') {
      return `${head}\nThe job has completed.`;
    }
    return `${head}\nThe job has ended.`;
  },
});

export const contentItemTools: readonly ToolDefinition[] = [
  getGenerationJobStatus,
  listContentItems,
  getContentItem,
  createContentItem,
  updateContentItem,
  deleteContentItem,
  duplicateContentItem,
  listContentItemVersions,
  restoreContentItemVersion,
  generateSeoMeta,
  validateBrandVoice,
  repurposeContentItem,
  quickRepurposeContentItem,
  translateContentItem,
  generateCoverImage,
];

export { itemLine, describeItem };
