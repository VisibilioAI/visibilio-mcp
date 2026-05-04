import { stubTool, type ToolDescriptor } from './_define.js';

export const intelligenceTools: readonly ToolDescriptor[] = [
  stubTool('analyze_content'),
  stubTool('score_relevance'),
  stubTool('validate_voice'),
  stubTool('crawl_urls'),
  stubTool('discover_sources'),
  stubTool('get_source_status'),
];
