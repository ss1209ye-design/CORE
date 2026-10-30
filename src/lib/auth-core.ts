import type { Pool } from 'pg';
import { getAuthDatabase } from './auth-database';
import { betterAuth } from 'better-auth';
import {
  APIError,
  createAuthMiddleware,
  formCsrfMiddleware,
} from 'better-auth/api';
import { nextCookies } from 'better-auth/next-js';
import { username } from 'better-auth/plugins';
import { readAuthConfiguration, type AuthConfiguration } from './auth-config';
import {
  internalUsernameEmail,
  isValidUsername,
  normalizeUsername,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
} from './auth-username';

export function createAuth(configuration: AuthConfiguration, database: Pool) {
  return betterAuth({
    baseURL: configuration.baseURL,
    secret: configuration.secret,
    trustedOrigins: [configuration.baseURL],
    database,
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      minPasswordLength: 8,
      maxPasswordLength: 128,
    },
    user: {
      additionalFields: {
        guideCompleted: {
          type: 'boolean',
          defaultValue: false,
          required: false,
        },
      },
    },
    disabledPaths: ['/sign-in/email'],
    hooks: {
      before: createAuthMiddleware(async (context) => {
        if (context.path === '/sign-in/username') {
          await formCsrfMiddleware(context);
        }
        if (context.path !== '/sign-up/email') return;

        const rawBody: unknown = context.body;
        if (
          rawBody === null ||
          typeof rawBody !== 'object' ||
          Array.isArray(rawBody)
        ) {
          throw APIError.from('BAD_REQUEST', {
            message: 'A valid username is required.',
            code: 'INVALID_USERNAME',
          });
        }

        const body = rawBody as Record<string, unknown>;
        const username =
          typeof body.username === 'string'
            ? normalizeUsername(body.username)
            : '';

        if (!isValidUsername(username)) {
          throw APIError.from('BAD_REQUEST', {
            message: 'A valid username is required.',
            code: 'INVALID_USERNAME',
          });
        }

        return {
          context: {
            ...context,
            body: {
              ...body,
              username,
              email: internalUsernameEmail(username),
              name: username,
              guideCompleted: false,
            },
          },
        };
      }),
    },
    session: {
      cookieCache: { enabled: false },
    },
    rateLimit: {
      enabled: true,
      storage: 'database',
    },
    advanced: {
      useSecureCookies: configuration.baseURL.startsWith('https:'),
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: 'lax',
        secure: configuration.baseURL.startsWith('https:'),
        path: '/',
      },
    },
    plugins: [
      username({
        displayUsername: false,
        immutableUsername: true,
        minUsernameLength: USERNAME_MIN_LENGTH,
        maxUsernameLength: USERNAME_MAX_LENGTH,
        usernameNormalization: normalizeUsername,
        usernameValidator: isValidUsername,
        validationOrder: { username: 'post-normalization' },
      }),
      nextCookies(),
    ],
  });
}

type Auth = ReturnType<typeof createAuth>;
const globalForAuth = globalThis as typeof globalThis & {
  auth?: { instance: Auth; configuration: AuthConfiguration };
};
export function getAuth(): Auth {
  const configuration = readAuthConfiguration();
  if (!configuration)
    throw new Error('Authentication configuration is missing or invalid.');
  const existing = globalForAuth.auth;
  if (existing) {
    if (
      existing.configuration.baseURL !== configuration.baseURL ||
      existing.configuration.secret !== configuration.secret ||
      existing.configuration.databaseURL !== configuration.databaseURL
    )
      throw new Error(
        'Restart the server to apply authentication configuration changes.',
      );
    return existing.instance;
  }
  const instance = createAuth(configuration, getAuthDatabase());
  globalForAuth.auth = { instance, configuration };
  return instance;
}
