import { stubTool, type ToolDescriptor } from './_define.js';

export const workflowTools: readonly ToolDescriptor[] = [
  stubTool('start_workflow'),
  stubTool('confirm_workflow'),
  stubTool('get_workflow_status'),
  stubTool('cancel_workflow'),
];
