import { stubTool, type ToolDescriptor } from './_define.js';

export const onboardingTools: readonly ToolDescriptor[] = [
  stubTool('start_onboarding'),
  stubTool('get_onboarding_status'),
  stubTool('validate_onboarding'),
];
