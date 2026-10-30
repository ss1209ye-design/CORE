import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
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

function createLocalAuth(configuration: AuthConfiguration, readOnly: boolean) {
  const databasePath = resolve(configuration.databasePath);
  if (!existsSync(databasePath)) {
    throw new Error(
      'The local authentication database is missing. Run the authentication setup script first.',
    );
  }

  return betterAuth({
    baseURL: configuration.baseURL,
    secret: configuration.secret,
    trustedOrigins: [configuration.baseURL],
    database: new DatabaseSync(databasePath, { readOnly }),
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

type LocalAuth = ReturnType<typeof createLocalAuth>;

type AuthSingleton = {
  auth: LocalAuth;
  configuration: AuthConfiguration;
  readOnly: boolean;
};

const globalForAuth = globalThis as typeof globalThis & {
  localAuth?: AuthSingleton;
};

export function getLocalAuth(options: { readOnly?: boolean } = {}): LocalAuth {
  const readOnly = options.readOnly ?? false;
  const configuration = readAuthConfiguration();
  if (!configuration) {
    throw new Error(
      'Local authentication configuration is missing or invalid.',
    );
  }

  const existing = globalForAuth.localAuth;
  if (existing) {
    if (
      existing.configuration.baseURL !== configuration.baseURL ||
      existing.configuration.secret !== configuration.secret ||
      existing.configuration.databasePath !== configuration.databasePath ||
      existing.readOnly !== readOnly
    ) {
      throw new Error(
        'Local authentication configuration changed. Restart the server to apply it.',
      );
    }
    return existing.auth;
  }

  const auth = createLocalAuth(configuration, readOnly);
  globalForAuth.localAuth = { auth, configuration, readOnly };
  return auth;
}
