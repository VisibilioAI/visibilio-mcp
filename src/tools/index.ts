import { audienceTools } from './audience.js';
import { briefingTools } from './briefing.js';
import { contentTools } from './content.js';
import { contentPlanTools } from './content-plans.js';
import { imageTools } from './image.js';
import { intelligenceTools } from './intelligence.js';
import { knowledgeTools } from './knowledge.js';
import { onboardingTools } from './onboarding.js';
import { organizationTools } from './organization.js';
import { strategyTools } from './strategy.js';
import { workflowTools } from './workflow.js';

import type { ToolDescriptor } from './_define.js';

export const allTools: readonly ToolDescriptor[] = [
  ...audienceTools,
  ...briefingTools,
  ...contentTools,
  ...contentPlanTools,
  ...imageTools,
  ...intelligenceTools,
  ...knowledgeTools,
  ...onboardingTools,
  ...organizationTools,
  ...strategyTools,
  ...workflowTools,
];

export type { ToolDescriptor } from './_define.js';
