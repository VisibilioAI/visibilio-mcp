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
import type { McpSession } from '../session.js';

const CONTENT_ITEM_ID = /^content-item:(\d+)$/;
export const RESULTS_PER_PRODUCT = 10;
export const MAX_RESULTS = 20;
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

async function publishedUrlsForProduct(
  session: McpSession,
  productId: unknown
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const rows = asArray<Row>(
      unwrapData(
        await session.client.get(`/api/v2/organizations/${session.organizationId}/published-feed`, {
          product_id: Number(productId),
        })
      )
    );
    for (const row of rows) {
      const live = row.live_url;
      if (typeof live === 'string' && live.trim()) map.set(String(row.content_item_id), live);
    }
  } catch {
    return new Map();
  }
  return map;
}

export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<a\b[^>]*?\bhref=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi, (_m, _q, href, inner) => {
      const text = String(inner)
        .replace(/<[^>]+>/g, '')
        .trim();
      return text ? `[${text}](${String(href)})` : String(href);
    })
    .replace(/<\/(td|th)>/gi, ' | ')
    .replace(/<\/(p|div|h[1-6]|li|blockquote|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .split('\n')
    .map((line) =>
      line
        .trim()
        .replace(/\s*\|\s*$/, '')
        .trim()
    )
    .filter((line) => line.length > 0)
    .join('\n');
}

const search = defineTool({
  name: 'search',
  title: 'Search',
  description:
    'Search content items across every product of the active organization by free text (ChatGPT connector contract). The server matches your query as-is against titles and bodies, so you do not need to add % or _ wildcards or wrap a phrase in quotes. Returns at most 10 results per product and at most 20 results in total across the organization; there is no paging, so make the query more specific to surface different items. Returns {results: [{id, title, url}]}; pass a result id to fetch for the full text.',
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
      const items = asArray<Row>(unwrapData(body));
      const publishedUrls = items.some((item) => item.status === 'published')
        ? await publishedUrlsForProduct(session, product.id)
        : new Map<string, string>();
      for (const item of items) {
        results.push({
          id: `content-item:${String(item.id)}`,
          title: titleOf(item),
          url:
            (item.status === 'published' && publishedUrls.get(String(item.id))) ||
            contentItemUrl(session.organizationId, item.id),
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
    const fallbackUrl = contentItemUrl(session.organizationId, item.id);
    const url =
      item.status === 'published' && item.product_id != null
        ? ((await publishedUrlsForProduct(session, item.product_id)).get(String(item.id)) ??
          fallbackUrl)
        : fallbackUrl;
    return {
      structuredContent: {
        id,
        title: titleOf(item),
        text: htmlToText(String(item.body ?? '')),
        url,
        metadata,
      },
    };
  },
});

export const searchTools: readonly ToolDefinition[] = [search, fetchDocument];
