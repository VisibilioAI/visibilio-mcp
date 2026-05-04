import { stubTool, type ToolDescriptor } from './_define.js';

export const contentPlanTools: readonly ToolDescriptor[] = [
  stubTool('list_content_plans'),
  stubTool('create_content_plan'),
  stubTool('get_content_plan'),
  stubTool('generate_content_plan'),
  stubTool('get_content_plan_status'),
];
