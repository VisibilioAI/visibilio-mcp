import { defineTool, type ToolDescriptor } from './_define.js';
import { formatHttpError } from './_format.js';

interface BriefingResponse {
  executive_overview?: string;
  key_developments?: Array<{
    title?: string;
    source_name?: string;
    url?: string;
    summary?: string;
    relevance_score?: number;
  }>;
}

const getBriefing = defineTool('get_briefing', async (_args, session) => {
  try {
    const body = (await session.client.backendPost(
      '/api/v2/intelligence/briefing/generate',
      { signals: [], target_developments_count: 3 },
      session.buildTenantHeaders()
    )) as BriefingResponse | null;
    if (!body) return 'No briefing available.';
    const sections = ['Executive Overview:', body.executive_overview ?? '(empty)'];
    if (body.key_developments && body.key_developments.length > 0) {
      sections.push('', 'Key Developments:');
      for (const dev of body.key_developments) {
        const score = dev.relevance_score !== undefined ? ` [score ${dev.relevance_score}]` : '';
        const source = dev.source_name ? ` — ${dev.source_name}` : '';
        sections.push(`- ${dev.title ?? 'Untitled'}${source}${score}`);
        if (dev.summary) sections.push(`  ${dev.summary}`);
        if (dev.url) sections.push(`  ${dev.url}`);
      }
    }
    return sections.join('\n');
  } catch (err) {
    return formatHttpError('Error generating briefing', err);
  }
});

export const briefingTools: readonly ToolDescriptor[] = [getBriefing];
