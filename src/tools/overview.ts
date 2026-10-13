import { z } from 'zod';
import {
  defineTool,
  mutating,
  numberArg,
  optionalProductId,
  pick,
  readOnly,
  requireNumberArg,
  requireStringArg,
  resolveProductId,
  ToolError,
  unwrapData,
  type ToolDefinition,
} from './_define.js';
import { asArray, line, listOrEmpty, nameOf, truncate, type Row } from './_format.js';

const getDailyBriefing = defineTool({
  name: 'get_daily_briefing',
  title: 'Get daily briefing',
  description:
    'The executive briefing for a product: an overview of what happened and the key developments worth acting on (may take a few seconds).',
  inputSchema: {
    product_id: z.number().int().optional().describe('Defaults to the active product'),
  },
  annotations: readOnly,
  handler: async (args, session) => {
    const productId = resolveProductId(args, session);
    const briefing = unwrapData<Row>(
      await session.client.get('/api/v2/dashboard/briefing', {
        orgId: session.organizationId,
        productId,
      })
    );
    const developments = asArray<Row>(briefing.key_developments).map((d) =>
      line(nameOf(d), 'signal_id', d.signal_id, [
        typeof d.relevance_score === 'number' ? `score: ${d.relevance_score}` : undefined,
        typeof d.source_name === 'string' ? d.source_name : undefined,
        typeof d.url === 'string' ? d.url : undefined,
      ])
    );
    return [
      `Executive overview:\n${String(briefing.executive_overview ?? '(empty)')}`,
      listOrEmpty('Key developments:', developments, 'Key developments: none.'),
      typeof briefing.generated_at === 'string' ? `Generated at ${briefing.generated_at}` : null,
    ]
      .filter((s): s is string => s !== null)
      .join('\n\n');
  },
});

const getOperationOverview = defineTool({
  name: 'get_operation_overview',
  title: 'Get operation overview',
  description:
    'Production health for a product: planned, in production and shipped counts, publishing rhythm, risks and topics needing attention.',
  inputSchema: {
    product_id: z.number().int().optional(),
    period_hours: z.number().int().optional().describe('Default 168 (one week)'),
  },
  annotations: readOnly,
  handler: async (args, session) => {
    const productId = optionalProductId(args, session);
    const overview = unwrapData<Row>(
      await session.client.get(
        `/api/v2/organizations/${session.organizationId}/operation-overview`,
        {
          ...(productId !== undefined ? { product_id: productId } : {}),
          ...(pick(args, ['period_hours']) as Record<string, number>),
        }
      )
    );
    return JSON.stringify(overview, null, 2);
  },
});

const getReviewQueue = defineTool({
  name: 'get_review_queue',
  title: 'Get review queue',
  description:
    'Content items waiting for review or with requested changes, with their quality risk score. Approve with approve_content_item or send back with request_content_changes.',
  inputSchema: { product_id: z.number().int().optional(), sort: z.enum(['risk']).optional() },
  annotations: readOnly,
  handler: async (args, session) => {
    const productId = optionalProductId(args, session);
    const items = asArray<Row>(
      unwrapData(
        await session.client.get(`/api/v2/organizations/${session.organizationId}/review-queue`, {
          ...(productId !== undefined ? { product_id: productId } : {}),
          ...(pick(args, ['sort']) as Record<string, string>),
        })
      )
    );
    return listOrEmpty(
      `Review queue (${items.length}):`,
      items.map((i) => {
        const risk =
          i.quality_verdict && typeof i.quality_verdict === 'object'
            ? (i.quality_verdict as Row).risk_score
            : undefined;
        return line(nameOf(i), 'content_item_id', i.id, [
          typeof i.status === 'string' ? i.status : undefined,
          typeof risk === 'number' ? `risk: ${risk}` : undefined,
          i.issue === true ? 'has issue' : undefined,
        ]);
      }),
      'The review queue is empty.'
    );
  },
});

const approveContentItem = defineTool({
  name: 'approve_content_item',
  title: 'Approve content item',
  description:
    'Approve a content item that is in review; optionally place it into the publishing schedule right away.',
  inputSchema: { content_item_id: z.number().int(), schedule: z.boolean().optional() },
  annotations: mutating,
  handler: async (args, session) => {
    const itemId = requireNumberArg(args, 'content_item_id');
    const result = unwrapData<Row>(
      await session.client.post(
        `/api/v2/organizations/${session.organizationId}/content-items/${itemId}/approve`,
        pick(args, ['schedule'])
      )
    );
    return `Content item ${itemId} is now ${String(result.status ?? 'approved')}.`;
  },
});

const requestContentChanges = defineTool({
  name: 'request_content_changes',
  title: 'Request content changes',
  description:
    'Send a content item back with a reason and a note; Visibilio starts a revision job that rewrites it accordingly.',
  inputSchema: {
    content_item_id: z.number().int(),
    reason: z.string().min(1),
    note: z.string().min(1),
  },
  annotations: mutating,
  handler: async (args, session) => {
    const itemId = requireNumberArg(args, 'content_item_id');
    const result = unwrapData<Row>(
      await session.client.post(
        `/api/v2/organizations/${session.organizationId}/content-items/${itemId}/request-changes`,
        {
          reason: requireStringArg(args, 'reason'),
          note: requireStringArg(args, 'note'),
        }
      )
    );
    return `Changes requested for content item ${itemId}: revision job ${String(result.job_id)} (${String(result.status)}).`;
  },
});

const getActivityFeed = defineTool({
  name: 'get_activity_feed',
  title: 'Get activity feed',
  description:
    'Recent activity across the organization: published and scheduled items, generated content, high-scoring signals.',
  inputSchema: { limit: z.number().int().min(1).max(50).optional() },
  annotations: readOnly,
  handler: async (args, session) => {
    const events = asArray<Row>(
      unwrapData(
        await session.client.get(
          `/api/v2/organizations/${session.organizationId}/activity-feed`,
          pick(args, ['limit']) as Record<string, number>
        )
      )
    );
    return listOrEmpty(
      `Activity (${events.length}):`,
      events.map(
        (e) =>
          `- ${String(e.created_at ?? '').slice(0, 16)} · ${String(e.type)} · ${truncate(e.description, 120)}${e.product_name ? ` [${String(e.product_name)}]` : ''}`
      ),
      'No recent activity.'
    );
  },
});

const getProductStats = defineTool({
  name: 'get_product_stats',
  title: 'Get product stats',
  description:
    'Per-product snapshot: new signals, top signal, drafts, scheduled items and content-plan progress.',
  inputSchema: {},
  annotations: readOnly,
  handler: async (_args, session) => {
    const stats = unwrapData<Row>(
      await session.client.get(`/api/v2/organizations/${session.organizationId}/product-stats`)
    );
    const products = asArray<Row>(stats.products);
    return listOrEmpty(
      'Product stats:',
      products.map((p) => {
        const progress =
          p.content_plan_progress && typeof p.content_plan_progress === 'object'
            ? (p.content_plan_progress as Row)
            : null;
        return line(String(p.product_name ?? 'Product'), 'product_id', p.product_id, [
          `new signals: ${String(p.new_signals_count ?? 0)}`,
          `drafts: ${String(p.drafts_count ?? 0)}`,
          `scheduled: ${String(p.scheduled_today_count ?? 0)}`,
          progress ? `plan: ${String(progress.completed)}/${String(progress.total)}` : undefined,
        ]);
      }),
      'No products.'
    );
  },
});

const listNotifications = defineTool({
  name: 'list_notifications',
  title: 'List notifications',
  description:
    'List the user notifications (content ready, approvals, publishing results) newest first.',
  inputSchema: {
    product_id: z.number().int().optional(),
    limit: z.number().int().min(1).max(100).optional(),
    offset: z.number().int().optional(),
  },
  annotations: readOnly,
  handler: async (args, session) => {
    const productId = optionalProductId(args, session);
    const body = (await session.client.get('/api/v2/notifications', {
      ...(productId !== undefined ? { product_id: productId } : {}),
      ...(pick(args, ['limit', 'offset']) as Record<string, number>),
    })) as Row;
    const notifications = asArray<Row>(body.data);
    return listOrEmpty(
      `Notifications (${notifications.length}${typeof body.total === 'number' ? ` of ${body.total}` : ''}):`,
      notifications.map((n) =>
        line(nameOf(n), 'notification_id', n.id, [
          n.read === false ? 'unread' : 'read',
          typeof n.type === 'string' ? n.type : undefined,
          typeof n.created_at === 'string' ? n.created_at.slice(0, 16) : undefined,
          typeof n.body === 'string' ? truncate(n.body, 100) : undefined,
        ])
      ),
      'No notifications.'
    );
  },
});

const getNotificationCount = defineTool({
  name: 'get_notification_count',
  title: 'Get notification count',
  description: 'Number of unread notifications.',
  inputSchema: { product_id: z.number().int().optional() },
  annotations: readOnly,
  handler: async (args, session) => {
    const productId = optionalProductId(args, session);
    const body = (await session.client.get(
      '/api/v2/notifications/count',
      productId !== undefined ? { product_id: productId } : undefined
    )) as Row;
    return `Unread notifications: ${String(body.count ?? 0)}`;
  },
});

const markNotificationsRead = defineTool({
  name: 'mark_notifications_read',
  title: 'Mark notifications read',
  description: 'Mark one notification (notification_id) or all notifications (all=true) as read.',
  inputSchema: {
    notification_id: z.number().int().optional(),
    all: z.boolean().optional(),
    product_id: z.number().int().optional(),
  },
  annotations: mutating,
  handler: async (args, session) => {
    const notificationId = numberArg(args, 'notification_id');
    if (notificationId === undefined && args.all !== true)
      throw new ToolError('Pass notification_id or all=true');
    const payload =
      notificationId !== undefined
        ? { notification_id: notificationId }
        : { all: true, ...pick(args, ['product_id']) };
    await session.client.post('/api/v2/notifications/read', payload);
    return notificationId !== undefined
      ? `Notification ${notificationId} marked as read.`
      : 'All notifications marked as read.';
  },
});

export const overviewTools: readonly ToolDefinition[] = [
  getDailyBriefing,
  getOperationOverview,
  getReviewQueue,
  approveContentItem,
  requestContentChanges,
  getActivityFeed,
  getProductStats,
  listNotifications,
  getNotificationCount,
  markNotificationsRead,
];
