import { stubTool, type ToolDescriptor } from './_define.js';

export const knowledgeTools: readonly ToolDescriptor[] = [
  stubTool('get_knowledge'),
  stubTool('update_knowledge'),
  stubTool('search_knowledge'),
];
