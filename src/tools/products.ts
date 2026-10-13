import { z } from 'zod';
import {
  defineTool,
  mutating,
  pick,
  readOnly,
  requireNumberArg,
  requireStringArg,
  resolveProductId,
  unwrapData,
  type ToolDefinition,
} from './_define.js';
import { fields, type Row } from './_format.js';

function describeProduct(product: Row): string {
  return fields([
    ['Product', product.name],
    ['product_id', product.id],
    ['description', product.description],
    ['type', product.product_type],
    ['website', product.website_url],
    ['languages', product.supported_languages],
    ['archived', product.is_archived === true ? 'yes' : undefined],
    ['onboarding', product.onboarding_status],
  ]);
}

const getProduct = defineTool({
  name: 'get_product',
  title: 'Get product',
  description: 'Show the details of one product (name, description, type, supported languages, archive state).',
  inputSchema: { product_id: z.number().int().optional().describe('Defaults to the active product') },
  annotations: readOnly,
  handler: async (args, session) => {
    const productId = resolveProductId(args, session);
    const product = unwrapData<Row>(await session.client.get(`/api/v2/products/${productId}`));
    return describeProduct(product);
  },
});

const createProduct = defineTool({
  name: 'create_product',
  title: 'Create product',
  description:
    'Create a new product (brand, site or person profile) in the active organization. Onboarding (knowledge, audiences, strategy) is done afterwards in the Visibilio app.',
  inputSchema: {
    name: z.string().min(1).max(100),
    description: z.string().optional(),
    product_type: z.enum(['standard', 'content_hub', 'person']).optional(),
  },
  annotations: mutating,
  handler: async (args, session) => {
    requireStringArg(args, 'name');
    const product = unwrapData<Row>(
      await session.client.post('/api/v2/products', pick(args, ['name', 'description', 'product_type']))
    );
    return `Product created.\n${describeProduct(product)}`;
  },
});

const updateProduct = defineTool({
  name: 'update_product',
  title: 'Update product',
  description: 'Rename, describe, pin or archive a product. Only the fields you pass are changed.',
  inputSchema: {
    product_id: z.number().int(),
    name: z.string().min(1).max(100).optional(),
    description: z.string().optional(),
    is_pinned: z.boolean().optional(),
    is_archived: z.boolean().optional(),
  },
  annotations: mutating,
  handler: async (args, session) => {
    const productId = requireNumberArg(args, 'product_id');
    const product = unwrapData<Row>(
      await session.client.patch(
        `/api/v2/products/${productId}`,
        pick(args, ['name', 'description', 'is_pinned', 'is_archived'])
      )
    );
    return `Product updated.\n${describeProduct(product)}`;
  },
});

export const productTools: readonly ToolDefinition[] = [getProduct, createProduct, updateProduct];
