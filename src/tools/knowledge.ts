import { z } from 'zod';
import type { McpSession } from '../session.js';
import {
  defineTool,
  mutating,
  optionalProductId,
  pick,
  readOnly,
  requireNumberArg,
  requireStringArg,
  ToolError,
  unwrapData,
  type ToolArgs,
  type ToolDefinition,
} from './_define.js';
import { asArray, fields, line, listOrEmpty, type Row } from './_format.js';

export const KNOWLEDGE_DOMAINS = [
  'company_profile',
  'market_intelligence',
  'audience_data',
  'content_strategy',
  'historical_outputs',
  'scoring_profile',
  'hub_config',
  'person_profile',
] as const;

export type KnowledgeDomain = (typeof KNOWLEDGE_DOMAINS)[number];

export function assertDomain(value: unknown): KnowledgeDomain {
  if (typeof value === 'string' && (KNOWLEDGE_DOMAINS as readonly string[]).includes(value)) {
    return value as KnowledgeDomain;
  }
  throw new ToolError(
    `Invalid domain "${String(value)}". Valid domains: ${KNOWLEDGE_DOMAINS.join(', ')}`
  );
}

function knowledgePath(domain: KnowledgeDomain, productId: number | undefined): string {
  return productId !== undefined
    ? `/api/v2/products/${productId}/knowledge/${domain}`
    : `/api/v2/knowledge/${domain}`;
}

function versionOf(row: Row): string | undefined {
  const version = row.version;
  if (
    version &&
    typeof version === 'object' &&
    typeof (version as Row).version_number === 'number'
  ) {
    return `version ${String((version as Row).version_number)}`;
  }
  return undefined;
}

export async function readKnowledge(
  session: McpSession,
  args: ToolArgs,
  domain: KnowledgeDomain
): Promise<Row> {
  const productId = optionalProductId(args, session);
  return unwrapData<Row>(await session.client.get(knowledgePath(domain, productId)));
}

export function renderKnowledge(row: Row, domain: string): string {
  const content = row.content;
  const empty =
    content === null ||
    content === undefined ||
    (typeof content === 'object' && Object.keys(content as object).length === 0);
  const head = fields([
    ['domain', domain],
    ['product_id', row.product_id],
    ['version', versionOf(row)],
    ['freshness_score', row.freshness_score],
    ['trust_label', row.trust_label],
  ]);
  if (empty) return `${head}\nNo ${domain.replace(/_/g, ' ')} recorded yet.`;
  return `${head}\n${JSON.stringify(content, null, 2)}`;
}

const getKnowledge = defineTool({
  name: 'get_knowledge',
  title: 'Get knowledge',
  description:
    'Read one knowledge domain of the product knowledge base: company_profile, market_intelligence, audience_data, content_strategy, historical_outputs, scoring_profile, hub_config or person_profile. Falls back to organization-level knowledge when no product is active.',
  inputSchema: {
    domain: z.enum(KNOWLEDGE_DOMAINS),
    product_id: z.number().int().optional().describe('Defaults to the active product'),
  },
  annotations: readOnly,
  handler: async (args, session) => {
    const domain = assertDomain(args.domain);
    return renderKnowledge(await readKnowledge(session, args, domain), domain);
  },
});

const updateKnowledge = defineTool({
  name: 'update_knowledge',
  title: 'Update knowledge',
  description:
    'Replace the content of a knowledge domain (full replace; read it first with get_knowledge, merge your edits, then write). Creates a new version.',
  inputSchema: {
    domain: z.enum(KNOWLEDGE_DOMAINS),
    content: z.record(z.unknown()).describe('The complete new content object'),
    change_note: z.string().optional(),
    product_id: z.number().int().optional(),
  },
  annotations: mutating,
  handler: async (args, session) => {
    const domain = assertDomain(args.domain);
    if (!args.content || typeof args.content !== 'object')
      throw new ToolError('content must be an object');
    const productId = optionalProductId(args, session);
    const row = unwrapData<Row>(
      await session.client.put(
        knowledgePath(domain, productId),
        pick(args, ['content', 'change_note'])
      )
    );
    return `Knowledge updated (${versionOf(row) ?? 'new version'}).\n${renderKnowledge(row, domain)}`;
  },
});

const searchKnowledge = defineTool({
  name: 'search_knowledge',
  title: 'Search knowledge',
  description:
    'Semantic search across the organization knowledge base. Returns matching fragments with their domain and relevance.',
  inputSchema: {
    query: z.string().min(3),
    domains: z.array(z.enum(KNOWLEDGE_DOMAINS)).optional(),
  },
  annotations: readOnly,
  handler: async (args, session) => {
    requireStringArg(args, 'query');
    const body = (await session.client.post(
      '/api/v2/knowledge/search',
      pick(args, ['query', 'domains'])
    )) as Row;
    const results = asArray<Row>(body.results);
    return listOrEmpty(
      `Results for "${String(body.query ?? args.query)}" (${results.length}):`,
      results.map(
        (r) =>
          `- [${String(r.domain)}] relevance ${typeof r.relevance_score === 'number' ? r.relevance_score.toFixed(2) : '?'}\n  ${JSON.stringify(r.content)}`
      ),
      'No matches.'
    );
  },
});

const listKnowledgeProposals = defineTool({
  name: 'list_knowledge_proposals',
  title: 'List knowledge proposals',
  description:
    'List pending knowledge updates proposed by Visibilio (from scans, signals and research) that await acceptance.',
  inputSchema: { product_id: z.number().int().optional() },
  annotations: readOnly,
  handler: async (args, session) => {
    const productId = optionalProductId(args, session);
    const proposals = asArray<Row>(
      unwrapData(
        await session.client.get(
          '/api/v2/knowledge/proposals',
          productId !== undefined ? { product_id: productId } : undefined
        )
      )
    );
    return listOrEmpty(
      `Pending knowledge proposals (${proposals.length}):`,
      proposals.map((p) =>
        line(`${String(p.domain)} from ${String(p.source ?? 'unknown')}`, 'proposal_id', p.id, [
          typeof p.proposed_at === 'string' ? p.proposed_at.slice(0, 10) : undefined,
        ])
      ),
      'No pending proposals.'
    );
  },
});

const acceptKnowledgeProposal = defineTool({
  name: 'accept_knowledge_proposal',
  title: 'Accept knowledge proposal',
  description: 'Accept a pending knowledge proposal, writing it as a new version of its domain.',
  inputSchema: { proposal_id: z.number().int() },
  annotations: mutating,
  handler: async (args, session) => {
    const proposalId = requireNumberArg(args, 'proposal_id');
    const result = unwrapData<Row>(
      await session.client.post(`/api/v2/knowledge/proposals/${proposalId}/accept`)
    );
    return `Proposal ${proposalId} ${String(result.status)} into ${String(result.domain)} (${versionOf(result) ?? 'new version'}).`;
  },
});

const dismissKnowledgeProposal = defineTool({
  name: 'dismiss_knowledge_proposal',
  title: 'Dismiss knowledge proposal',
  description: 'Dismiss a pending knowledge proposal for 30 days.',
  inputSchema: { proposal_id: z.number().int() },
  annotations: mutating,
  handler: async (args, session) => {
    const proposalId = requireNumberArg(args, 'proposal_id');
    const result = unwrapData<Row>(
      await session.client.post(`/api/v2/knowledge/proposals/${proposalId}/dismiss`)
    );
    return `Proposal ${proposalId} ${String(result.status)}.`;
  },
});

export const knowledgeTools: readonly ToolDefinition[] = [
  getKnowledge,
  updateKnowledge,
  searchKnowledge,
  listKnowledgeProposals,
  acceptKnowledgeProposal,
  dismissKnowledgeProposal,
];
