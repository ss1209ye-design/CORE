import { isIP } from 'node:net';

export type AuthConfiguration = Readonly<{
  baseURL: string;
  secret: string;
  databaseURL: string;
}>;

function configuredOrigin(value: string | undefined): string | null {
  if (!value?.trim()) return null;

  try {
    const url = new URL(value.trim());
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const loopback =
      host === 'localhost' ||
      host === '::1' ||
      (isIP(host) === 4 && host.startsWith('127.'));

    if (
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    ) {
      return null;
    }

    return url.origin;
  } catch {
    return null;
  }
}

export function readAuthConfiguration(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): AuthConfiguration | null {
  const baseURL = configuredOrigin(environment.BETTER_AUTH_URL);
  const secret = environment.BETTER_AUTH_SECRET;
  const databaseURL = environment.DATABASE_URL?.trim();
  try {
    const url = new URL(databaseURL ?? '');
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !url.hostname ||
      !url.username ||
      url.hash
    )
      return null;
  } catch {
    return null;
  }

  if (!baseURL || !secret || secret.length < 32 || !databaseURL) {
    return null;
  }

  return {
    baseURL,
    secret,
    databaseURL,
  };
}
