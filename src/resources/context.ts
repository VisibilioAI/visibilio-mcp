import { stubResource, type ResourceDescriptor } from './_define.js';

export const contextResources: readonly ResourceDescriptor[] = [
  stubResource('current_organization'),
  stubResource('current_project'),
];
