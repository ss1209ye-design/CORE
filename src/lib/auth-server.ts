import 'server-only';

import { headers } from 'next/headers';
import { getLocalAuth } from './auth-core';
import { readAuthConfiguration } from './auth-config';

export function isAuthConfigured(): boolean {
  return readAuthConfiguration() !== null;
}

export async function getAuthenticatedUser() {
  if (!isAuthConfigured()) return null;
  const requestHeaders = await headers();
  try {
    const session = await getLocalAuth().api.getSession({
      headers: requestHeaders,
    });
    return session?.user ?? null;
  } catch {
    return null;
  }
}
