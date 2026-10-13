import { z } from 'zod';
import {
  defineTool,
  readOnly,
  requireStringArg,
  stringArg,
  ToolError,
  unwrapData,
  type ToolDefinition,
} from './_define.js';
import { asArray, type Row } from './_format.js';
import { fetchProducts } from './context.js';
import { fetchItem } from './content-items.js';

const CONTENT_ITEM_ID = /^content-item:(\d+)$/;
const RESULTS_PER_PRODUCT = 10;
const MAX_RESULTS = 20;
const METADATA_FIELDS = ['type', 'status', 'platform', 'language', 'product_id'] as const;

interface SearchResult {
  readonly id: string;
  readonly title: string;
  readonly url: string;
}

function appUrl(): string {
  return (process.env.VISIBILIO_FRONTEND_URL ?? 'https://app.visibilio.ai').replace(/\/$/, '');
}

function contentItemUrl(organizationId: number, itemId: unknown): string {
  return `${appUrl()}/${organizationId}/content/${String(itemId)}`;
}

function titleOf(item: Row): string {
  return typeof item.title === 'string' && item.title.trim() ? item.title : 'Untitled';
}

export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|blockquote|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

const search = defineTool({
  name: 'search',
  title: 'Search',
  description:
    'Search content items across every product of the active organization by free text (ChatGPT connector contract). Returns {results: [{id, title, url}]}; pass a result id to fetch for the full text.',
  inputSchema: {
    query: z.string().describe('Free-text query matched against titles and bodies'),
  },
  annotations: readOnly,
  handler: async (args, session) => {
    const query = stringArg(args, 'query');
    if (!query) return { structuredContent: { results: [] } };
    const results: SearchResult[] = [];
    for (const product of await fetchProducts(session)) {
      const body = await session.client.get(`/api/v2/products/${product.id}/content-items`, {
        search: query,
        limit: RESULTS_PER_PRODUCT,
      });
      for (const item of asArray<Row>(unwrapData(body))) {
        results.push({
          id: `content-item:${String(item.id)}`,
          title: titleOf(item),
          url: contentItemUrl(session.organizationId, item.id),
        });
      }
    }
    return { structuredContent: { results: results.slice(0, MAX_RESULTS) } };
  },
});

const fetchDocument = defineTool({
  name: 'fetch',
  title: 'Fetch',
  description:
    'Fetch one document by an id returned from search (content-item:<id>) as {id, title, text, url, metadata} with the body as plain text (ChatGPT connector contract).',
  inputSchema: {
    id: z.string().describe('A result id from search, e.g. content-item:123'),
  },
  annotations: readOnly,
  handler: async (args, session) => {
    const id = requireStringArg(args, 'id');
    const match = CONTENT_ITEM_ID.exec(id);
    if (!match) {
      throw new ToolError(`Unknown id "${id}". Expected content-item:<id> as returned by search.`);
    }
    const item = await fetchItem(session, Number(match[1]));
    const metadata = Object.fromEntries(
      METADATA_FIELDS.map((key) => [key, item[key]]).filter(([, value]) => value != null)
    );
    return {
      structuredContent: {
        id,
        title: titleOf(item),
        text: htmlToText(String(item.body ?? '')),
        url: contentItemUrl(session.organizationId, item.id),
        metadata,
      },
    };
  },
});

export const searchTools: readonly ToolDefinition[] = [search, fetchDocument];
