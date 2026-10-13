import { z } from 'zod';
import {
  defineTool,
  describeError,
  mutating,
  readOnly,
  requireNumberArg,
  ToolError,
  unwrapData,
  type ToolDefinition,
} from './_define.js';
import type { McpSession } from '../session.js';

interface ProductShape {
  id: number;
  name?: string | null;
  description?: string | null;
  website_url?: string | null;
  default_language?: string | null;
  is_archived?: boolean;
  onboarding_status?: string | null;
}

interface ProductsListShape {
  products?: ProductShape[];
  data?: ProductShape[];
  total?: number;
}

export async function fetchProducts(session: McpSession): Promise<ProductShape[]> {
  const body = (await session.client.get('/api/v2/products')) as ProductsListShape | ProductShape[];
  if (Array.isArray(body)) return body;
  return body.products ?? body.data ?? [];
}

function describeProduct(product: ProductShape): string {
  const extras = [
    product.website_url ? `site: ${product.website_url}` : null,
    product.default_language ? `language: ${product.default_language}` : null,
    product.is_archived ? 'archived' : null,
  ].filter((s): s is string => s !== null);
  return `- ${product.name ?? 'Unnamed'} (product_id: ${product.id})${extras.length ? ` — ${extras.join(', ')}` : ''}`;
}

const whoami = defineTool({
  name: 'whoami',
  title: 'Who am I',
  description:
    'Show the authenticated Visibilio user, the active organization and the active product for this session. Call this first to orient yourself.',
  inputSchema: {},
  annotations: readOnly,
  handler: async (_args, session) => {
    const org = session.organization;
    return [
      `User: ${session.auth.name || session.auth.email} <${session.auth.email}> (user_id: ${session.userId})`,
      `Active organization: ${org?.name ?? 'unknown'} (organization_id: ${session.organizationId}, role: ${org?.role ?? 'unknown'})`,
      session.product
        ? `Active product: ${session.product.name ?? 'Unnamed'} (product_id: ${session.product.id})`
        : 'Active product: none — call list_products then set_active_product, or pass product_id to product tools.',
      `Organizations available: ${session.organizations.length}`,
    ].join('\n');
  },
});

const listOrganizations = defineTool({
  name: 'list_organizations',
  title: 'List organizations',
  description:
    'List every organization the authenticated user belongs to, with the role in each. Use set_active_organization to switch.',
  inputSchema: {},
  annotations: readOnly,
  handler: async (_args, session) => {
    const lines = session.organizations.map(
      (org) =>
        `- ${org.name || 'Unnamed'} (organization_id: ${org.id}, role: ${org.role})${org.id === session.organizationId ? ' ← active' : ''}`
    );
    return `Organizations:\n${lines.join('\n')}`;
  },
});

const setActiveOrganization = defineTool({
  name: 'set_active_organization',
  title: 'Set active organization',
  description:
    'Switch the session to another organization the user belongs to. Clears the active product; call list_products afterwards.',
  inputSchema: {
    organization_id: z.number().int().describe('Numeric organization id from list_organizations'),
  },
  annotations: mutating,
  handler: async (args, session) => {
    const organizationId = requireNumberArg(args, 'organization_id');
    if (!session.organizations.some((org) => org.id === organizationId)) {
      throw new ToolError(
        `You are not a member of organization ${organizationId}. Call list_organizations to see your organizations.`
      );
    }
    const membership = session.setActiveOrganization(organizationId);
    return `Active organization set to ${membership.name || membership.id} (organization_id: ${membership.id}). Active product cleared — call list_products to pick one.`;
  },
});

const listProducts = defineTool({
  name: 'list_products',
  title: 'List products',
  description:
    'List the products (brands, sites or personal profiles) in the active organization. Every content, knowledge and publishing tool is scoped to one product.',
  inputSchema: {},
  annotations: readOnly,
  handler: async (_args, session) => {
    try {
      const products = await fetchProducts(session);
      if (products.length === 0) {
        return 'No products in this organization yet. Create one in the Visibilio app (onboarding) first.';
      }
      const active = session.productId;
      const lines = products.map(
        (p) => `${describeProduct(p)}${p.id === active ? ' ← active' : ''}`
      );
      return `Products:\n${lines.join('\n')}`;
    } catch (err) {
      return describeError('Error listing products', err);
    }
  },
});

const setActiveProduct = defineTool({
  name: 'set_active_product',
  title: 'Set active product',
  description:
    'Choose the product that subsequent content, knowledge, planning and publishing tools operate on.',
  inputSchema: {
    product_id: z.number().int().describe('Numeric product id from list_products'),
  },
  annotations: mutating,
  handler: async (args, session) => {
    const productId = requireNumberArg(args, 'product_id');
    try {
      const product = unwrapData<ProductShape>(
        await session.client.get(`/api/v2/products/${productId}`)
      );
      session.setActiveProduct(product.id, product.name ?? null);
      return `Active product set: ${product.name ?? 'Unnamed'} (product_id: ${product.id}). Product tools now default to it.`;
    } catch (err) {
      return describeError(`Could not activate product ${productId}`, err);
    }
  },
});

export const contextTools: readonly ToolDefinition[] = [
  whoami,
  listOrganizations,
  setActiveOrganization,
  listProducts,
  setActiveProduct,
];
