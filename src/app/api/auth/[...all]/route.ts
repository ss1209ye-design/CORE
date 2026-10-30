import { toNextJsHandler } from 'better-auth/next-js';
import { getLocalAuth } from '@/lib/auth-core';

function createHandler(method: 'GET' | 'POST') {
  return async (request: Request) => {
    const handlers = toNextJsHandler(getLocalAuth());
    return handlers[method](request);
  };
}

export const GET = createHandler('GET');
export const POST = createHandler('POST');
