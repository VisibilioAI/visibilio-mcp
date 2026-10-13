import { searchTools } from './search.js';
import { contextTools } from './context.js';
import { productTools } from './products.js';
import { contentItemTools } from './content-items.js';
import { briefTools } from './briefs.js';
import { workflowTools } from './workflow.js';
import { contentPlanTools } from './content-plans.js';
import { audienceTools } from './audiences.js';
import { knowledgeTools } from './knowledge.js';
import { brandVoiceTools } from './brand-voice.js';
import { publishingTools } from './publishing.js';
import { signalTools } from './signals.js';
import { overviewTools } from './overview.js';
import { measurementTools } from './measurement.js';
import { feedbackTools } from './feedback.js';
import type { ToolDefinition } from './_define.js';

export const allTools: readonly ToolDefinition[] = [
  ...searchTools,
  ...contextTools,
  ...productTools,
  ...contentItemTools,
  ...briefTools,
  ...workflowTools,
  ...contentPlanTools,
  ...audienceTools,
  ...knowledgeTools,
  ...brandVoiceTools,
  ...publishingTools,
  ...signalTools,
  ...overviewTools,
  ...measurementTools,
  ...feedbackTools,
];

export type { ToolDefinition } from './_define.js';
