import { defineTool, stubTool, type ToolDescriptor } from './_define.js';
import { formatHttpError, requireString } from './_format.js';

const VALID_DOMAINS = [
  'company_profile',
  'market_intelligence',
  'audience_data',
  'content_strategy',
  'historical_outputs',
  'scoring_profile',
  'hub_config',
] as const;

const getKnowledge = defineTool('get_knowledge', async (args, session) => {
  const domain = requireString(args, 'domain');
  if (!(VALID_DOMAINS as readonly string[]).includes(domain)) {
    return `Invalid domain '${domain}'. Valid domains: ${VALID_DOMAINS.join(', ')}`;
  }
  try {
    const path = `/api/v2/knowledge/${session.organizationId}/${domain}`;
    const body = (await session.client.backendGet(path, session.buildTenantHeaders())) as {
      content?: unknown;
      data?: unknown;
    } | null;
    const content = body?.content ?? body?.data ?? null;
    if (content === null || content === undefined) {
      return `No data found for domain '${domain}'. Run onboarding first.`;
    }
    return typeof content === 'string' ? content : JSON.stringify(content, null, 2);
  } catch (err) {
    return formatHttpError(`Error fetching knowledge ${domain}`, err);
  }
});

export const knowledgeTools: readonly ToolDescriptor[] = [
  getKnowledge,
  stubTool('update_knowledge'),
  stubTool('search_knowledge'),
];
