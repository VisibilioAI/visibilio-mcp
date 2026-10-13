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
  resolveProductId,
  unwrapData,
  type ToolDefinition,
} from './_define.js';
import { asArray, fields, line, listOrEmpty, nameOf, type Row } from './_format.js';

function channelLine(channel: Row): string {
  return line(nameOf(channel), 'channel_id', channel.id, [
    typeof channel.platform === 'string' ? channel.platform : undefined,
    channel.is_active === false ? 'inactive' : 'active',
    typeof channel.role === 'string' ? `role: ${channel.role}` : undefined,
  ]);
}

function scheduleLine(schedule: Row): string {
  return line(
    `Content item ${String(schedule.content_item_id)} → channel ${String(schedule.channel_id)}`,
    'schedule_id',
    schedule.id,
    [
      typeof schedule.publish_at === 'string' ? `publish_at: ${schedule.publish_at}` : undefined,
      typeof schedule.status === 'string' ? schedule.status : undefined,
      typeof schedule.published_url === 'string' ? schedule.published_url : undefined,
      typeof schedule.error === 'string' ? `error: ${schedule.error}` : undefined,
    ]
  );
}

const listChannels = defineTool({
  name: 'list_channels',
  title: 'List channels',
  description:
    'List every publishing channel connected to the organization (social accounts, sites, newsletters) with platform and active state.',
  inputSchema: {},
  annotations: readOnly,
  handler: async (_args, session) => {
    const channels = asArray<Row>(unwrapData(await session.client.get('/api/v2/channels')));
    return listOrEmpty(
      `Channels (${channels.length}):`,
      channels.map(channelLine),
      'No channels connected. Connect one in Settings → Channels.'
    );
  },
});

const listProductChannels = defineTool({
  name: 'list_product_channels',
  title: 'List product channels',
  description: 'List the channels linked to a product and their role (primary, distribution).',
  inputSchema: {
    product_id: z.number().int().optional().describe('Defaults to the active product'),
  },
  annotations: readOnly,
  handler: async (args, session) => {
    const productId = resolveProductId(args, session);
    const channels = asArray<Row>(
      unwrapData(await session.client.get(`/api/v2/products/${productId}/channels`))
    );
    return listOrEmpty(
      `Channels of product ${productId}:`,
      channels.map(channelLine),
      'No channels linked to this product.'
    );
  },
});

const publishSocialPost = defineTool({
  name: 'publish_social_post',
  title: 'Publish social post',
  description:
    'Publish a social_post content item to a connected social channel right now. Returns a schedule id to poll with list_schedules for the final state.',
  inputSchema: {
    content_item_id: z.number().int(),
    channel_id: z.number().int(),
    source_article_link: z.boolean().optional().describe('Append the link of the source article'),
  },
  annotations: mutating,
  handler: async (args, session) => {
    const itemId = requireNumberArg(args, 'content_item_id');
    const result = unwrapData<Row>(
      await session.client.post(
        `/api/v2/content-items/${itemId}/publish-social`,
        pick(args, ['channel_id', 'source_article_link'])
      )
    );
    if (result.already_published) return `Content item ${itemId} was already published.`;
    return fields([
      ['status', result.status],
      ['schedule_id', result.schedule_id],
      ['zernio_post_id', result.zernio_post_id],
      [
        'note',
        result.already_in_progress
          ? 'a publish was already in progress'
          : 'final state arrives via webhook; check list_schedules',
      ],
    ]);
  },
});

const listContentHubs = defineTool({
  name: 'list_content_hubs',
  title: 'List content hubs',
  description:
    'List the content hubs (websites: GitHub, WordPress, Cloudflare Pages, webhook) available to a product.',
  inputSchema: { product_id: z.number().int().optional() },
  annotations: readOnly,
  handler: async (args, session) => {
    const productId = optionalProductId(args, session);
    const hubs = asArray<Row>(
      unwrapData(
        await session.client.get(
          '/api/v2/content-hubs',
          productId !== undefined ? { product_id: productId } : undefined
        )
      )
    );
    return listOrEmpty(
      `Content hubs (${hubs.length}):`,
      hubs.map((h) =>
        line(nameOf(h), 'hub_id', h.id, [
          typeof h.site_url === 'string' ? h.site_url : undefined,
          h.is_active === false ? 'inactive' : 'active',
          h.product_id === null ? 'organization-level' : undefined,
        ])
      ),
      'No content hubs configured.'
    );
  },
});

const publishToHub = defineTool({
  name: 'publish_to_hub',
  title: 'Publish to hub',
  description:
    'Publish an article to a content hub (website) immediately. Returns the live URL once deployed.',
  inputSchema: {
    hub_id: z.number().int(),
    content_item_id: z.number().int(),
    slug: z.string().optional(),
    primary_category: z.string().optional(),
    cross_post_channels: z
      .array(z.number().int())
      .optional()
      .describe('Social channel ids to announce the post on'),
    source_article_link: z.boolean().optional(),
  },
  annotations: mutating,
  handler: async (args, session) => {
    const hubId = requireNumberArg(args, 'hub_id');
    const itemId = requireNumberArg(args, 'content_item_id');
    const publication = unwrapData<Row>(
      await session.client.post(
        `/api/v2/content-hubs/${hubId}/publish/${itemId}`,
        pick(args, ['slug', 'primary_category', 'cross_post_channels', 'source_article_link'])
      )
    );
    return fields([
      ['status', publication.status],
      ['live_url', publication.live_url],
      ['file_path', publication.file_path],
      ['publication_id', publication.id],
      ['error', publication.error],
    ]);
  },
});

const listHubPublications = defineTool({
  name: 'list_hub_publications',
  title: 'List hub publications',
  description: 'List what has been published to a content hub, with status and live URLs.',
  inputSchema: {
    hub_id: z.number().int(),
    status: z.enum(['pending', 'committed', 'deployed', 'failed']).optional(),
    limit: z.number().int().optional(),
  },
  annotations: readOnly,
  handler: async (args, session) => {
    const hubId = requireNumberArg(args, 'hub_id');
    const publications = asArray<Row>(
      unwrapData(
        await session.client.get(
          `/api/v2/content-hubs/${hubId}/publications`,
          pick(args, ['status', 'limit']) as Record<string, string | number>
        )
      )
    );
    return listOrEmpty(
      `Publications on hub ${hubId} (${publications.length}):`,
      publications.map((p) =>
        line(`Content item ${String(p.content_item_id)}`, 'publication_id', p.id, [
          typeof p.status === 'string' ? p.status : undefined,
          typeof p.live_url === 'string' ? p.live_url : undefined,
          typeof p.published_at === 'string' ? p.published_at.slice(0, 10) : undefined,
        ])
      ),
      'Nothing published on this hub yet.'
    );
  },
});

const listSchedules = defineTool({
  name: 'list_schedules',
  title: 'List schedules',
  description: 'List scheduled and past social publications with their status and published URLs.',
  inputSchema: {
    product_id: z.number().int().optional(),
    status: z.string().optional().describe('scheduled, publishing, published, failed, cancelled'),
    content_item_id: z.number().int().optional(),
    channel_id: z.number().int().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
  },
  annotations: readOnly,
  handler: async (args, session) => {
    const productId = optionalProductId(args, session);
    const schedules = asArray<Row>(
      unwrapData(
        await session.client.get('/api/v2/schedules', {
          ...(productId !== undefined ? { product_id: productId } : {}),
          ...(pick(args, ['status', 'content_item_id', 'channel_id', 'from', 'to']) as Record<
            string,
            string | number
          >),
        })
      )
    );
    return listOrEmpty(
      `Schedules (${schedules.length}):`,
      schedules.map(scheduleLine),
      'No schedules match.'
    );
  },
});

const scheduleContentItem = defineTool({
  name: 'schedule_content_item',
  title: 'Schedule content item',
  description:
    'Schedule a content item for publication on a channel at a given time (ISO 8601). The item moves to status scheduled.',
  inputSchema: {
    content_item_id: z.number().int(),
    channel_id: z.number().int(),
    publish_at: z.string().describe('ISO 8601 timestamp, e.g. 2026-10-20T09:00:00Z'),
    options: z
      .object({ primary_category: z.string().optional(), timezone: z.string().optional() })
      .optional(),
  },
  annotations: mutating,
  handler: async (args, session) => {
    requireNumberArg(args, 'content_item_id');
    requireNumberArg(args, 'channel_id');
    requireStringArg(args, 'publish_at');
    const body = (await session.client.post(
      '/api/v2/schedules',
      pick(args, ['content_item_id', 'channel_id', 'publish_at', 'options'])
    )) as Row;
    const schedule = (body.data as Row | undefined) ?? body;
    const warnings = ['cadence_warning', 'similarity_warning']
      .map((key) => (typeof body[key] === 'string' ? `Warning: ${String(body[key])}` : null))
      .filter((s): s is string => s !== null);
    return [`Scheduled.`, scheduleLine(schedule), ...warnings].join('\n');
  },
});

const cancelSchedule = defineTool({
  name: 'cancel_schedule',
  title: 'Cancel schedule',
  description:
    'Cancel a pending publication schedule. If it was the last one, the item goes back to approved.',
  inputSchema: { schedule_id: z.number().int() },
  annotations: destructive,
  handler: async (args, session) => {
    const scheduleId = requireNumberArg(args, 'schedule_id');
    await session.client.delete(`/api/v2/schedules/${scheduleId}`);
    return `Schedule ${scheduleId} cancelled.`;
  },
});

const getPublishedFeed = defineTool({
  name: 'get_published_feed',
  title: 'Get published feed',
  description:
    'What went live, where and whether it is still reachable: the organization publication feed (hubs and social) for a product and window.',
  inputSchema: {
    product_id: z.number().int().optional(),
    channel: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
  },
  annotations: readOnly,
  handler: async (args, session) => {
    const productId = optionalProductId(args, session);
    const entries = asArray<Row>(
      unwrapData(
        await session.client.get(`/api/v2/organizations/${session.organizationId}/published-feed`, {
          ...(productId !== undefined ? { product_id: productId } : {}),
          ...(pick(args, ['channel', 'from', 'to']) as Record<string, string>),
        })
      )
    );
    return listOrEmpty(
      `Published (${entries.length}):`,
      entries.map((e) => {
        const verification =
          e.verification && typeof e.verification === 'object'
            ? (e.verification as Row).state
            : undefined;
        return line(
          `Content item ${String(e.content_item_id)} via ${String(e.channel ?? e.source)}`,
          'id',
          e.id,
          [
            typeof e.live_url === 'string' ? e.live_url : undefined,
            typeof e.published_at === 'string' ? e.published_at.slice(0, 10) : undefined,
            typeof verification === 'string' ? `verification: ${verification}` : undefined,
          ]
        );
      }),
      'Nothing published in this window.'
    );
  },
});

export const publishingTools: readonly ToolDefinition[] = [
  listChannels,
  listProductChannels,
  publishSocialPost,
  listContentHubs,
  publishToHub,
  listHubPublications,
  listSchedules,
  scheduleContentItem,
  cancelSchedule,
  getPublishedFeed,
];
