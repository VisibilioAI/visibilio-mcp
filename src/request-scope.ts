import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestScope {
  readonly signal?: AbortSignal;
  readonly reportProgress?: () => void;
}

const storage = new AsyncLocalStorage<RequestScope>();

export function runInRequestScope<T>(scope: RequestScope, fn: () => T): T {
  return storage.run(scope, fn);
}

export function currentRequestScope(): RequestScope | undefined {
  return storage.getStore();
}
