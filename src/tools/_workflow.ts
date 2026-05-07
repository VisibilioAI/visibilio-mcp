import type { McpSession } from '../session.js';
import { formatHttpError } from './_format.js';

export interface RunWorkflowOptions {
  readonly contentType: string;
  readonly brief: string;
  readonly timeoutSeconds: number;
  readonly pollIntervalMs?: number;
}

interface StartResponse {
  execution_id?: string;
  state?: string;
  requires_confirmation?: boolean;
  final_output?: unknown;
}

interface StatusResponse {
  execution_id?: string;
  state?: string;
  final_output?: unknown;
  error?: string;
}

const TERMINAL_STATES = new Set(['completed', 'failed', 'cancelled', 'error']);

export async function runWorkflow(
  session: McpSession,
  options: RunWorkflowOptions
): Promise<string> {
  const pollIntervalMs = options.pollIntervalMs ?? 1500;
  const start = await startWorkflow(session, options);
  if (typeof start === 'string') return start;
  const { executionId, immediateOutput } = start;
  if (immediateOutput !== undefined) return formatOutput(immediateOutput);
  return pollUntilTerminal(session, executionId, options.timeoutSeconds, pollIntervalMs);
}

async function startWorkflow(
  session: McpSession,
  options: RunWorkflowOptions
): Promise<string | { executionId: string; immediateOutput: unknown }> {
  try {
    const body = {
      user_request: `Write a ${humanContentLabel(options.contentType)}: ${options.brief}`,
      auto_confirm: true,
      async_mode: true,
    };
    const response = (await session.client.backendPost(
      '/api/v2/workflow/start',
      body,
      session.buildTenantHeaders()
    )) as StartResponse;
    if (!response.execution_id) {
      return formatHttpError('Error starting workflow: missing execution_id', new Error('no_id'));
    }
    if (
      response.state &&
      TERMINAL_STATES.has(response.state) &&
      response.final_output !== undefined
    ) {
      return { executionId: response.execution_id, immediateOutput: response.final_output };
    }
    return { executionId: response.execution_id, immediateOutput: undefined };
  } catch (err) {
    return formatHttpError('Error starting workflow', err);
  }
}

async function pollUntilTerminal(
  session: McpSession,
  executionId: string,
  timeoutSeconds: number,
  pollIntervalMs: number
): Promise<string> {
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    const status = await fetchStatus(session, executionId);
    if (typeof status === 'string') return status;
    if (status.state && TERMINAL_STATES.has(status.state)) {
      if (status.state === 'completed') return formatOutput(status.final_output);
      return `Workflow ${executionId} ended with state "${status.state}"${status.error ? `: ${status.error}` : ''}`;
    }
    await sleep(pollIntervalMs);
  }
  return [
    `Workflow still running after ${timeoutSeconds}s timeout.`,
    `Call get_workflow_status with execution_id="${executionId}" to retrieve the result when ready.`,
  ].join(' ');
}

async function fetchStatus(
  session: McpSession,
  executionId: string
): Promise<string | StatusResponse> {
  try {
    return (await session.client.backendGet(
      `/api/v2/workflow/${executionId}/status`,
      session.buildTenantHeaders()
    )) as StatusResponse;
  } catch (err) {
    return formatHttpError(`Error fetching workflow ${executionId} status`, err);
  }
}

function formatOutput(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  if (raw === null || raw === undefined) return 'Workflow completed with no output.';
  return JSON.stringify(raw, null, 2);
}

const HUMAN_CONTENT_LABELS: Readonly<Record<string, string>> = {
  linkedin_post: 'LinkedIn post',
  blog_article: 'blog article',
  tweet: 'tweet',
  facebook_post: 'Facebook post',
  newsletter: 'newsletter',
  press_release: 'press release',
  email_campaign: 'email campaign',
  instagram_caption: 'Instagram caption',
  youtube_description: 'YouTube description',
  tiktok_script: 'TikTok script',
  website_copy: 'website copy',
  ad_copy: 'ad copy',
};

function humanContentLabel(contentType: string): string {
  return HUMAN_CONTENT_LABELS[contentType] ?? contentType.replace(/_/g, ' ');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
