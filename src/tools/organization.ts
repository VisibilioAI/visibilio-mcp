import { stubTool, type ToolDescriptor } from './_define.js';

export const organizationTools: readonly ToolDescriptor[] = [
  stubTool('list_projects'),
  stubTool('get_project'),
  stubTool('set_active_project'),
];
