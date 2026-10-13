import { z } from 'zod';
import type { McpSession } from '../session.js';
import {
  defineTool,
  mutating,
  numberArg,
  pick,
  readOnly,
  requireStringArg,
  resolveProductId,
  ToolError,
  unwrapData,
  type ToolDefinition,
} from './_define.js';
import { fields, type Row } from './_format.js';

async function currentStrategyVersion(session: McpSession, productId: number): Promise<number> {
  const row = unwrapData<Row>(
    await session.client.get(`/api/v2/products/${productId}/knowledge/content_strategy`)
  );
  const version = row.version;
  if (
    version &&
    typeof version === 'object' &&
    typeof (version as Row).version_number === 'number'
  ) {
    return (version as Row).version_number as number;
  }
  return 0;
}

function renderVoice(body: Row): string {
  const version =
    body.version && typeof body.version === 'object'
      ? (body.version as Row).version_number
      : undefined;
  const head = fields([
    ['structured', body.has_structured === true ? 'yes' : 'no'],
    ['version', typeof version === 'number' ? `version ${version}` : undefined],
  ]);
  if (body.document) return `${head}\n${JSON.stringify(body.document, null, 2)}`;
  if (typeof body.legacy_text === 'string' && body.legacy_text)
    return `${head}\nLegacy voice text:\n${body.legacy_text}`;
  return `${head}\nNo brand voice defined yet. Use analyze_brand_voice_text on sample content, then update_brand_voice.`;
}

const getBrandVoice = defineTool({
  name: 'get_brand_voice',
  title: 'Get brand voice',
  description:
    "Read the structured brand voice document of a product (voice statement, tone, style, vocabulary, do/don't lists).",
  inputSchema: {
    product_id: z.number().int().optional().describe('Defaults to the active product'),
  },
  annotations: readOnly,
  handler: async (args, session) => {
    const productId = resolveProductId(args, session);
    return renderVoice((await session.client.get(`/api/v2/brand-voice/${productId}`)) as Row);
  },
});

const updateBrandVoice = defineTool({
  name: 'update_brand_voice',
  title: 'Update brand voice',
  description:
    'Save a complete brand voice document for a product. Read the current one with get_brand_voice, edit, and write it back; the current content_strategy version is fetched automatically for optimistic locking.',
  inputSchema: {
    product_id: z.number().int().optional(),
    document: z.record(z.unknown()).describe('A full BrandVoiceDocument (schema_version 1)'),
    version_number: z
      .number()
      .int()
      .optional()
      .describe('content_strategy knowledge version; auto-detected when omitted'),
  },
  annotations: mutating,
  handler: async (args, session) => {
    const productId = resolveProductId(args, session);
    if (!args.document || typeof args.document !== 'object')
      throw new ToolError('document must be an object');
    const versionNumber =
      numberArg(args, 'version_number') ?? (await currentStrategyVersion(session, productId));
    const body = (await session.client.put(`/api/v2/brand-voice/${productId}`, {
      document: args.document,
      version_number: versionNumber,
    })) as Row;
    return `Brand voice saved.\n${renderVoice(body)}`;
  },
});

const analyzeBrandVoiceText = defineTool({
  name: 'analyze_brand_voice_text',
  title: 'Analyze brand voice from text',
  description:
    'Derive a brand voice document from sample writing (100-50,000 characters). Returns an execution id; poll get_brand_voice_analysis, then save the result with update_brand_voice.',
  inputSchema: {
    product_id: z.number().int().optional(),
    text: z.string().min(100).max(50_000),
    mode: z
      .enum(['replace', 'merge'])
      .optional()
      .describe('merge (default) blends with the existing voice'),
    source_label: z.string().max(200).optional(),
  },
  annotations: mutating,
  handler: async (args, session) => {
    const productId = resolveProductId(args, session);
    requireStringArg(args, 'text');
    const result = (await session.client.post(
      `/api/v2/brand-voice/${productId}/analyze-text`,
      pick(args, ['text', 'mode', 'source_label'])
    )) as Row;
    return `Analysis started: execution_id ${String(result.execution_id)} (${String(result.status)}). Poll get_brand_voice_analysis(execution_id).`;
  },
});

const getBrandVoiceAnalysis = defineTool({
  name: 'get_brand_voice_analysis',
  title: 'Get brand voice analysis',
  description:
    'Poll a brand voice analysis. When completed it returns the proposed document; save it with update_brand_voice.',
  inputSchema: { execution_id: z.string(), product_id: z.number().int().optional() },
  annotations: readOnly,
  handler: async (args, session) => {
    const productId = resolveProductId(args, session);
    const executionId = requireStringArg(args, 'execution_id');
    const result = (await session.client.get(
      `/api/v2/brand-voice/${productId}/generate/${executionId}`
    )) as Row;
    const head = fields([
      ['execution_id', executionId],
      ['status', result.status],
      [
        'progress',
        typeof result.progress_percentage === 'number'
          ? `${result.progress_percentage}%`
          : result.progress_message,
      ],
      ['error', result.error],
    ]);
    if (!result.brand_voice)
      return `${head}\n${result.status === 'completed' ? 'No document returned.' : 'Still running; poll again shortly.'}`;
    return `${head}\n${JSON.stringify(result.brand_voice, null, 2)}\nSave it with update_brand_voice(document: <this document>).`;
  },
});

export const brandVoiceTools: readonly ToolDefinition[] = [
  getBrandVoice,
  updateBrandVoice,
  analyzeBrandVoiceText,
  getBrandVoiceAnalysis,
];
