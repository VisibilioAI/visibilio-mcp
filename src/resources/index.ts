import type { McpSession } from '../session.js';
import { unwrapData } from '../tools/_define.js';
import { fields, type Row } from '../tools/_format.js';
import { KNOWLEDGE_DOMAINS, readKnowledge, renderKnowledge } from '../tools/knowledge.js';

export interface ResourceDefinition {
  readonly name: string;
  readonly uri: string;
  readonly title: string;
  readonly description: string;
  readonly mimeType: string;
  readonly read: (session: McpSession) => Promise<string>;
}

const organization: ResourceDefinition = {
  name: 'organization',
  uri: 'visibilio://organization',
  title: 'Current organization',
  description: 'The authenticated user, the active organization and the active product of this session.',
  mimeType: 'text/plain',
  read: async (session) =>
    fields([
      ['user', `${session.auth.name || session.auth.email} <${session.auth.email}>`],
      ['user_id', session.userId],
      ['organization', session.organization?.name],
      ['organization_id', session.organizationId],
      ['role', session.organization?.role],
      ['product', session.product?.name],
      ['product_id', session.productId],
      ['organizations', session.organizations.map((o) => `${o.name} (${o.id})`)],
    ]),
};

const product: ResourceDefinition = {
  name: 'product',
  uri: 'visibilio://product',
  title: 'Active product',
  description: 'Details of the product the session is scoped to.',
  mimeType: 'application/json',
  read: async (session) => {
    if (session.productId === null) {
      return JSON.stringify({ message: 'No active product. Call list_products, then set_active_product.' }, null, 2);
    }
    return JSON.stringify(unwrapData<Row>(await session.client.get(`/api/v2/products/${session.productId}`)), null, 2);
  },
};

const knowledgeResources: ResourceDefinition[] = KNOWLEDGE_DOMAINS.map((domain) => ({
  name: `knowledge_${domain}`,
  uri: `visibilio://knowledge/${domain}`,
  title: `Knowledge: ${domain.replace(/_/g, ' ')}`,
  description: `The ${domain.replace(/_/g, ' ')} knowledge domain of the active product (organization-level when no product is active).`,
  mimeType: 'application/json',
  read: async (session) => renderKnowledge(await readKnowledge(session, {}, domain), domain),
}));

export const allResources: readonly ResourceDefinition[] = [organization, product, ...knowledgeResources];
