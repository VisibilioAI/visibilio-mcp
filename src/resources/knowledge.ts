import type { McpSession } from '../session.js';
import { defineResource, stubResource, type ResourceDescriptor } from './_define.js';
import { formatHttpError } from '../tools/_format.js';

async function readKnowledgeDomain(session: McpSession, domain: string): Promise<string> {
  try {
    const path = `/api/v2/knowledge/${session.organizationId}/${domain}`;
    const body = (await session.client.backendGet(path, session.buildTenantHeaders())) as {
      content?: unknown;
      data?: unknown;
    } | null;
    const content = body?.content ?? body?.data ?? null;
    if (content === null || content === undefined) {
      const friendly = domain.replace(/_/g, ' ');
      return `No ${friendly} data available. Run onboarding first.`;
    }
    return typeof content === 'string' ? content : JSON.stringify(content, null, 2);
  } catch (err) {
    return formatHttpError(`Error reading ${domain}`, err);
  }
}

const companyProfile = defineResource('company_profile', (s) =>
  readKnowledgeDomain(s, 'company_profile')
);
const scoringProfile = defineResource('scoring_profile', (s) =>
  readKnowledgeDomain(s, 'scoring_profile')
);

export const knowledgeResources: readonly ResourceDescriptor[] = [
  companyProfile,
  stubResource('market_intelligence'),
  stubResource('audience_data'),
  stubResource('content_strategy'),
  stubResource('historical_outputs'),
  scoringProfile,
  stubResource('hub_config'),
];
