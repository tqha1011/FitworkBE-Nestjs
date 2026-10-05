import { AsyncLocalStorage } from 'node:async_hooks';

export const requestContext = new AsyncLocalStorage<{
  requestId: string;
  traceId?: string;
  spanId?: string;
}>();
