import { contextResources } from './context.js';
import { knowledgeResources } from './knowledge.js';
import type { ResourceDescriptor } from './_define.js';

export const allResources: readonly ResourceDescriptor[] = [
  ...contextResources,
  ...knowledgeResources,
];

export type { ResourceDescriptor } from './_define.js';
