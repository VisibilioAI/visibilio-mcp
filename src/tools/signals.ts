import { z } from 'zod';
import {
  defineTool,
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
import { asArray, fields, line, listOrEmpty, nameOf, truncate, type Row } from './_format.js';

function signalLine(signal: Row): string {
  return line(nameOf(signal), 'signal_id', signal.id, [
    typeof signal.relevance_score === 'number' ? `score: ${signal.relevance_score}` : undefined,
    typeof signal.source_name === 'string' ? signal.source_name : undefined,
    typeof signal.scanned_at === 'string' ? signal.scanned_at.slice(0, 10) : undefined,
    typeof signal.url === 'string' ? signal.url : undefined,
  ]);
}

const listSignals = defineTool({
  name: 'list_signals',
  title: 'List signals',
  description:
    'List scored market signals (news, posts, trends) scanned from the product sources: what is worth writing about now. Sorted by relevance by default.',
  inputSchema: {
    product_id: z.number().int().optional().describe('Defaults to the active product'),
    min_score: z.number().min(0).max(100).optional(),
    unused_only: z.boolean().optional().describe('Only signals not yet turned into content'),
    source_type: z.string().optional(),
    topic: z.string().optional(),
    since: z.string().optional().describe('ISO date'),
    sort: z.enum(['relevance', 'newest', 'oldest']).optional(),
    limit: z.number().int().min(1).max(200).optional(),
  },
  annotations: readOnly,
  handler: async (args, session) => {
    const productId = optionalProductId(args, session);
    const signals = asArray<Row>(
      unwrapData(
        await session.client.get('/api/v2/signals', {
          ...(productId !== undefined ? { product_id: productId } : {}),
          ...(pick(args, [
            'min_score',
            'unused_only',
            'source_type',
            'topic',
            'since',
            'sort',
            'limit',
          ]) as Record<string, string | number | boolean>),
        })
      )
    );
    return listOrEmpty(
      `Signals (${signals.length}):`,
      signals.map(signalLine),
      'No signals match. Try broader filters or check the sources configured in Visibilio.'
    );
  },
});

const getSignal = defineTool({
  name: 'get_signal',
  title: 'Get signal',
  description:
    'Read one signal in full: summary, topics, suggested actions, content angles and source.',
  inputSchema: { signal_id: z.number().int() },
  annotations: readOnly,
  handler: async (args, session) => {
    const signalId = requireNumberArg(args, 'signal_id');
    const signal = unwrapData<Row>(await session.client.get(`/api/v2/signals/${signalId}`));
    return fields([
      ['Signal', signal.title],
      ['signal_id', signal.id],
      ['score', signal.relevance_score],
      ['source', signal.source_name],
      ['url', signal.url],
      ['scanned_at', signal.scanned_at],
      ['summary', signal.summary],
      ['topics', signal.topics],
      ['content_type', signal.content_type],
      ['suggested_actions', signal.suggested_actions],
      ['content_angles', signal.content_angles],
      ['reasoning', signal.reasoning],
      ['used_in', signal.used_in],
    ]);
  },
});

const generateFromSignal = defineTool({
  name: 'generate_from_signal',
  title: 'Generate from signal',
  description:
    'Turn a signal into content (e.g. output_types ["linkedin_post","blog_article"]). Returns an execution id; follow it with get_workflow_status, then save with create_content_item(type, source_execution_id).',
  inputSchema: {
    signal_id: z.number().int(),
    output_types: z
      .array(z.string())
      .min(1)
      .describe('e.g. linkedin_post, blog_article, tweet, newsletter'),
    additional_context: z.string().optional(),
    language: z.enum(['en', 'bg', 'de']).optional(),
  },
  annotations: mutating,
  handler: async (args, session) => {
    const signalId = requireNumberArg(args, 'signal_id');
    const result = unwrapData<Row>(
      await session.client.post(
        `/api/v2/signals/${signalId}/generate`,
        pick(args, ['output_types', 'additional_context', 'language'])
      )
    );
    return `Generation started from signal ${signalId}: execution_id ${String(result.execution_id)} (${String(result.state)}). Call get_workflow_status(execution_id) until it completes; each call waits up to 40 seconds.`;
  },
});

const addSignalToPlan = defineTool({
  name: 'add_signal_to_plan',
  title: 'Add signal to plan',
  description:
    'Insert a signal as a planned topic into the current content plan of its product, under a content pillar.',
  inputSchema: { signal_id: z.number().int(), pillar: z.string().min(1) },
  annotations: mutating,
  handler: async (args, session) => {
    const signalId = requireNumberArg(args, 'signal_id');
    const result = unwrapData<Row>(
      await session.client.post(`/api/v2/signals/${signalId}/add-to-plan`, {
        pillar: requireStringArg(args, 'pillar'),
      })
    );
    return `Signal ${signalId} ${String(result.action)} into the plan${result.plannedTopicId ? ` (topic_id: ${String(result.plannedTopicId)})` : ''}.`;
  },
});

const dismissSignal = defineTool({
  name: 'dismiss_signal',
  title: 'Dismiss signal',
  description: 'Hide a signal from the list (undo with undo=true).',
  inputSchema: { signal_id: z.number().int(), undo: z.boolean().optional() },
  annotations: mutating,
  handler: async (args, session) => {
    const signalId = requireNumberArg(args, 'signal_id');
    const result = unwrapData<Row>(
      await session.client.patch(`/api/v2/signals/${signalId}/dismiss`, pick(args, ['undo']))
    );
    return result.dismissed === false
      ? `Signal ${signalId} restored.`
      : `Signal ${signalId} dismissed.`;
  },
});

const getSignalStats = defineTool({
  name: 'get_signal_stats',
  title: 'Get signal stats',
  description:
    'Counts for the signal pipeline: active sources, items scanned in 24h, pending signals, scheduled content.',
  inputSchema: { product_id: z.number().int().optional() },
  annotations: readOnly,
  handler: async (args, session) => {
    const productId = optionalProductId(args, session);
    const stats = unwrapData<Row>(
      await session.client.get(
        '/api/v2/signals/stats',
        productId !== undefined ? { product_id: productId } : undefined
      )
    );
    return fields([
      ['active_sources', stats.active_sources],
      ['items_scanned_24h', stats.items_scanned_24h],
      ['pending_signals', stats.pending_signals],
      ['scheduled_content', stats.scheduled_content],
    ]);
  },
});

const listSources = defineTool({
  name: 'list_sources',
  title: 'List sources',
  description:
    'List the content sources (RSS feeds, websites, social feeds) the organization scans for signals.',
  inputSchema: { type: z.string().optional(), is_active: z.boolean().optional() },
  annotations: readOnly,
  handler: async (args, session) => {
    const sources = asArray<Row>(
      unwrapData(
        await session.client.get(
          '/api/v2/sources',
          pick(args, ['type', 'is_active']) as Record<string, string | boolean>
        )
      )
    );
    return listOrEmpty(
      `Sources (${sources.length}):`,
      sources.map((s) =>
        line(nameOf(s), 'source_id', s.id, [
          typeof s.type === 'string' ? s.type : undefined,
          typeof s.url === 'string' ? s.url : undefined,
          s.is_active === false ? 'inactive' : undefined,
          typeof s.last_scanned_at === 'string'
            ? `last scan: ${s.last_scanned_at.slice(0, 10)}`
            : undefined,
          typeof s.last_error === 'string' && s.last_error
            ? `error: ${truncate(s.last_error, 60)}`
            : undefined,
        ])
      ),
      'No sources yet. Add one with create_source.'
    );
  },
});

const createSource = defineTool({
  name: 'create_source',
  title: 'Create source',
  description: 'Add a source to scan for signals (rss, website, youtube, x, linkedin, reddit).',
  inputSchema: {
    name: z.string().min(1),
    type: z.enum(['rss', 'website', 'youtube', 'x', 'linkedin', 'reddit']),
    url: z.string().url(),
    scan_frequency_minutes: z.number().int().min(15).optional(),
    priority: z.number().int().min(1).max(10).optional(),
  },
  annotations: mutating,
  handler: async (args, session) => {
    requireStringArg(args, 'name');
    requireStringArg(args, 'url');
    const source = unwrapData<Row>(
      await session.client.post(
        '/api/v2/sources',
        pick(args, ['name', 'type', 'url', 'scan_frequency_minutes', 'priority'])
      )
    );
    return `Source created.\n${line(nameOf(source), 'source_id', source.id, [typeof source.type === 'string' ? source.type : undefined, typeof source.url === 'string' ? source.url : undefined])}`;
  },
});

const scanSource = defineTool({
  name: 'scan_source',
  title: 'Scan source',
  description:
    'Scan a source now and score the new items as signals for a product (synchronous, up to 2 minutes).',
  inputSchema: { source_id: z.number().int(), product_id: z.number().int().optional() },
  annotations: mutating,
  handler: async (args, session) => {
    const sourceId = requireNumberArg(args, 'source_id');
    const productId = resolveProductId(args, session);
    const result = unwrapData<Row>(
      await session.client.post(`/api/v2/sources/${sourceId}/scan`, { product_id: productId })
    );
    return `Scan of source ${sourceId} finished: ${String(result.items_found ?? 0)} items found, ${String(result.items_new ?? 0)} new. See list_signals.`;
  },
});

export const signalTools: readonly ToolDefinition[] = [
  listSignals,
  getSignal,
  generateFromSignal,
  addSignalToPlan,
  dismissSignal,
  getSignalStats,
  listSources,
  createSource,
  scanSource,
];
