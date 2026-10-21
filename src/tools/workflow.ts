import { z } from 'zod';
import type { McpSession } from '../session.js';
import {
  defineTool,
  destructive,
  mutating,
  optionalProductId,
  pick,
  readOnly,
  requireStringArg,
  type ToolDefinition,
} from './_define.js';
import { asArray, fields, type Row } from './_format.js';
import { piecesOf } from './_run.js';

function describePlan(plan: unknown): string | null {
  if (!plan || typeof plan !== 'object') return null;
  const steps = asArray<Row>((plan as Row).steps);
  if (steps.length === 0) return null;
  return `plan: ${steps.map((s) => String(s.agent_type ?? s.name ?? s.description ?? 'step')).join(' → ')}`;
}

function producedNothing(output: unknown): boolean {
  if (output === null || output === undefined) return true;
  if (typeof output !== 'object') return false;
  const row = output as Row;
  const steps = row.steps;
  const stepsEmpty =
    !!steps && typeof steps === 'object' && Object.keys(steps as object).length === 0;
  return row.steps_completed === 0 || stepsEmpty;
}

function renderOutput(output: unknown): string {
  if (output === null || output === undefined) return '(no output)';
  if (typeof output === 'string') return output;
  if (typeof output === 'object') {
    const row = output as Row;
    const title = typeof row.title === 'string' ? row.title : null;
    const content =
      typeof row.content === 'string'
        ? row.content
        : typeof row.body === 'string'
          ? row.body
          : null;
    if (title || content) {
      const rest = Object.fromEntries(
        Object.entries(row).filter(([k]) => !['title', 'content', 'body'].includes(k))
      );
      return [
        title ? `Title: ${title}` : null,
        content ? `\n${content}` : null,
        Object.keys(rest).length ? `\nOther fields: ${JSON.stringify(rest, null, 2)}` : null,
      ]
        .filter((s): s is string => s !== null)
        .join('\n');
    }
  }
  return JSON.stringify(output, null, 2);
}

const startWorkflow = defineTool({
  name: 'start_workflow',
  title: 'Start workflow',
  description:
    'Ask Visibilio to produce content from a natural-language request (e.g. "Write a LinkedIn post about our MCP launch"). The workflow planner picks the right writer and uses the product knowledge, brand voice and audiences. Returns an execution id to follow with get_workflow_status.',
  inputSchema: {
    user_request: z.string().min(10).max(5000),
    product_id: z.number().int().optional().describe('Defaults to the active product'),
    auto_confirm: z
      .boolean()
      .optional()
      .describe('Default true; false stops at awaiting_confirmation so you can review the plan'),
    audience_ids: z
      .array(z.string())
      .optional()
      .describe('Audience ids from list_audiences to write for'),
    source_url: z.string().url().optional().describe('A page to base the content on'),
    source_content: z.string().optional().describe('Raw text to base the content on'),
    include_cta: z.boolean().optional(),
  },
  annotations: mutating,
  handler: async (args, session) => {
    requireStringArg(args, 'user_request');
    const productId = optionalProductId(args, session);
    const payload: Record<string, unknown> = {
      ...pick(args, ['user_request', 'source_url', 'source_content', 'include_cta', 'language']),
      ...(productId !== undefined ? { product_id: productId } : {}),
      auto_confirm: args.auto_confirm !== false,
    };
    if (Array.isArray(args.audience_ids) && args.audience_ids.length) {
      payload.selected_segment_ids = args.audience_ids;
    }
    const result = (await session.client.post('/api/v2/workflow/start', payload)) as Row;
    return [
      `Workflow started: execution_id ${String(result.execution_id)}, state ${String(result.state)}.`,
      describePlan(result.plan),
      result.requires_confirmation
        ? 'The plan awaits your confirmation: call confirm_workflow.'
        : null,
      `Call get_workflow_status(execution_id: "${String(result.execution_id)}") until it completes; each call waits up to 40 seconds.`,
    ]
      .filter((s): s is string => s !== null)
      .join('\n');
  },
});

const confirmWorkflow = defineTool({
  name: 'confirm_workflow',
  title: 'Confirm workflow',
  description:
    'Confirm or reject a workflow plan that stopped at awaiting_confirmation (start_workflow with auto_confirm=false).',
  inputSchema: {
    execution_id: z.string(),
    confirmed: z.boolean(),
    modifications: z
      .object({
        remove_steps: z.array(z.string()).optional(),
        add_instructions: z.string().optional(),
      })
      .optional(),
  },
  annotations: mutating,
  handler: async (args, session) => {
    const executionId = requireStringArg(args, 'execution_id');
    const result = (await session.client.post(
      `/api/v2/workflow/${executionId}/confirm`,
      pick(args, ['confirmed', 'modifications'])
    )) as Row;
    return `Workflow ${executionId} is now ${String(result.state)}.${result.message ? ` ${String(result.message)}` : ''}`;
  },
});

const WAIT_BUDGET_MS = 40_000;
const POLL_INTERVAL_MS = 4_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function settledStatus(
  session: McpSession,
  executionId: string,
  deadline: number
): Promise<Row> {
  const status = (await session.client.get(`/api/v2/workflow/${executionId}/status`)) as Row;
  if (status.is_complete === true || Date.now() + POLL_INTERVAL_MS > deadline) return status;
  await sleep(POLL_INTERVAL_MS);
  return settledStatus(session, executionId, deadline);
}

function count(value: unknown): number {
  return asArray(value).length;
}

function describePiece(piece: Row, index: number): string {
  const assets = (piece.aeo_assets ?? {}) as Row;
  return [
    `Piece ${index + 1}: ${String(piece.title ?? 'Untitled')}`,
    fields([
      ['platform', piece.platform],
      ['words', piece.word_count],
      ['FAQ', count(assets.faqs)],
      ['summary bullets', count(assets.summary_bullets)],
      ['sources', count(assets.sources)],
    ]),
    '',
    String(piece.body ?? ''),
  ].join('\n');
}

function describePieces(pieces: readonly Row[], executionId: string): string {
  return [
    pieces.map(describePiece).join('\n\n'),
    '',
    `To keep a piece, call create_content_item(type, source_execution_id: "${executionId}"): its title, text, SEO meta, FAQ and summary come from the run.${pieces.length > 1 ? ' With several pieces, also pass the title or platform of the one to keep.' : ''}`,
  ].join('\n');
}

const getWorkflowStatus = defineTool({
  name: 'get_workflow_status',
  title: 'Get workflow status',
  description:
    'Check a workflow execution: state, progress, cost and (when completed) the generated pieces. While the run is going, the call waits up to 40 seconds for it to finish, so call it again only when it says the run is still going. Generated output is NOT saved automatically: persist it with create_content_item(type, source_execution_id).',
  inputSchema: { execution_id: z.string() },
  annotations: readOnly,
  handler: async (args, session) => {
    const executionId = requireStringArg(args, 'execution_id');
    const status = await settledStatus(session, executionId, Date.now() + WAIT_BUDGET_MS);
    const head = fields([
      ['execution_id', status.execution_id ?? executionId],
      ['state', status.state],
      [
        'progress',
        typeof status.progress_percentage === 'number'
          ? `${status.progress_percentage}%`
          : undefined,
      ],
      ['cost_usd', status.total_cost_usd],
      ['duration_seconds', status.duration_seconds],
      ['error', status.error],
    ]);
    if (status.state !== 'completed') {
      return `${head}\n${status.is_complete ? 'The run has ended.' : 'Still running; call get_workflow_status again (it waits up to 40 seconds).'}`;
    }
    if (producedNothing(status.final_output)) {
      return [
        head,
        '',
        'The run completed but produced nothing: Visibilio planned no steps for the request.',
        'Rephrase with an explicit content type and topic, e.g. "Write an article about …" or "Write a LinkedIn post about …", then start again.',
      ].join('\n');
    }
    const pieces = piecesOf(status.final_output);
    if (pieces.length > 0) {
      return [head, '', 'Output:', describePieces(pieces, executionId)].join('\n');
    }
    return [
      head,
      '',
      'Output:',
      renderOutput(status.final_output),
      '',
      `To keep this, call create_content_item(type, title, body, source_execution_id: "${executionId}").`,
    ].join('\n');
  },
});

const cancelWorkflow = defineTool({
  name: 'cancel_workflow',
  title: 'Cancel workflow',
  description: 'Cancel a running workflow execution.',
  inputSchema: { execution_id: z.string(), reason: z.string().optional() },
  annotations: destructive,
  handler: async (args, session) => {
    const executionId = requireStringArg(args, 'execution_id');
    await session.client.post(`/api/v2/workflow/${executionId}/cancel`, pick(args, ['reason']));
    return `Workflow ${executionId} cancelled.`;
  },
});

export const workflowTools: readonly ToolDefinition[] = [
  startWorkflow,
  confirmWorkflow,
  getWorkflowStatus,
  cancelWorkflow,
];
