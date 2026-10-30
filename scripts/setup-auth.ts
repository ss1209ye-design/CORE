import { randomBytes } from 'node:crypto';
import {
  appendFile,
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  writeFile,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { loadEnvConfig } from '@next/env';
import { parse } from 'dotenv';
import { getMigrations } from 'better-auth/db/migration';
import {
  DEFAULT_AUTH_DATABASE_PATH,
  readAuthConfiguration,
} from '../src/lib/auth-config';
import { getLocalAuth } from '../src/lib/auth-core';

const authEnvironmentKeys = [
  'BETTER_AUTH_URL',
  'BETTER_AUTH_SECRET',
  'BETTER_AUTH_DATABASE_PATH',
] as const;

type AuthEnvironment = Readonly<Record<string, string | undefined>>;

function hasAuthConfiguration(environment: AuthEnvironment): boolean {
  return authEnvironmentKeys.some((key) => environment[key] !== undefined);
}

function requireCompleteCredentials(
  environment: AuthEnvironment,
  source: string,
): void {
  const hasURL = environment.BETTER_AUTH_URL !== undefined;
  const hasSecret = environment.BETTER_AUTH_SECRET !== undefined;

  if (hasAuthConfiguration(environment) && (!hasURL || !hasSecret)) {
    throw new Error(
      `Incomplete Better Auth settings in ${source}; no existing values were changed.`,
    );
  }
}

async function readExistingEnvironmentFile(
  projectRoot: string,
): Promise<{ environmentPath: string; existingContents: string | null }> {
  loadEnvConfig(projectRoot, true);

  const environmentPath = join(projectRoot, '.env.local');
  let existingContents: string | null;
  try {
    const status = await lstat(environmentPath);
    if (!status.isFile()) {
      throw new Error(
        '.env.local must be a regular file; no values were changed.',
      );
    }
    existingContents = await readFile(environmentPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    existingContents = null;
  }

  const localEnvironment =
    existingContents === null ? {} : parse(existingContents);
  requireCompleteCredentials(localEnvironment as AuthEnvironment, '.env.local');
  requireCompleteCredentials(process.env, 'the loaded environment');

  return { environmentPath, existingContents };
}

async function ensureEnvironmentFile(projectRoot: string): Promise<void> {
  const { environmentPath, existingContents } =
    await readExistingEnvironmentFile(projectRoot);

  if (!hasAuthConfiguration(process.env)) {
    const secret = randomBytes(32).toString('base64url');
    const contents = [
      'BETTER_AUTH_URL=http://localhost:3000',
      `BETTER_AUTH_SECRET=${secret}`,
      `BETTER_AUTH_DATABASE_PATH=${DEFAULT_AUTH_DATABASE_PATH}`,
      '',
    ].join('\n');

    if (existingContents === null) {
      await writeFile(environmentPath, contents, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      });
    } else {
      const separator = existingContents.endsWith('\n') ? '' : '\n';
      await appendFile(environmentPath, `${separator}${contents}`, 'utf8');
    }

    await chmod(environmentPath, 0o600);
    loadEnvConfig(projectRoot, true, undefined, true);
  } else if (existingContents !== null) {
    await chmod(environmentPath, 0o600);
  }

  if (!readAuthConfiguration()) {
    throw new Error(
      'Better Auth settings are missing or invalid; no database changes were made.',
    );
  }
}

async function ensureDatabaseFile(databasePath: string): Promise<void> {
  try {
    const status = await lstat(databasePath);
    if (!status.isFile()) {
      throw new Error(
        'The configured authentication database path is not a regular file.',
      );
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;

    const file = await open(databasePath, 'wx', 0o600);
    await file.close();
  }

  const status = await lstat(databasePath);
  if (!status.isFile()) {
    throw new Error(
      'The configured authentication database path is not a regular file.',
    );
  }
  await chmod(databasePath, 0o600);
}

async function previewAuthentication(projectRoot: string): Promise<void> {
  await readExistingEnvironmentFile(projectRoot);

  const configuration = readAuthConfiguration();
  if (!configuration) {
    throw new Error(
      'Better Auth settings are missing or invalid; preview does not create or change files.',
    );
  }

  const databasePath = resolve(projectRoot, configuration.databasePath);
  let databaseStatus: Awaited<ReturnType<typeof lstat>>;
  try {
    databaseStatus = await lstat(databasePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    throw new Error(
      'The authentication database must already exist; preview does not create files.',
    );
  }
  if (!databaseStatus.isFile()) {
    throw new Error(
      'The configured authentication database path is not a regular file; preview did not change it.',
    );
  }

  const auth = getLocalAuth({ readOnly: true });
  const database = auth.options.database;
  if (!(database instanceof DatabaseSync)) {
    throw new Error(
      'Better Auth is not using the configured local SQLite database.',
    );
  }

  try {
    const migration = await getMigrations(auth.options);
    if (migration.unsafeChanges.length || migration.schemaProblems.length) {
      throw new Error(
        'The existing authentication database has schema conflicts; preview did not modify it.',
      );
    }

    console.log(await migration.compileMigrations());
  } finally {
    database.close();
  }
}

async function setupAuthentication(): Promise<void> {
  const projectRoot = process.cwd();
  if (process.argv.includes('--preview')) {
    await previewAuthentication(projectRoot);
    return;
  }

  await ensureEnvironmentFile(projectRoot);

  const configuration = readAuthConfiguration();
  if (!configuration) {
    throw new Error('Better Auth configuration is unavailable.');
  }

  const dataDirectory = resolve(projectRoot, '.data');
  await mkdir(dataDirectory, { recursive: true, mode: 0o700 });
  const dataDirectoryStatus = await lstat(dataDirectory);
  if (!dataDirectoryStatus.isDirectory()) {
    throw new Error(
      '.data must be a real directory; the database was not changed.',
    );
  }
  await chmod(dataDirectory, 0o700);

  const databasePath = resolve(projectRoot, configuration.databasePath);
  await ensureDatabaseFile(databasePath);

  const auth = getLocalAuth();
  const database = auth.options.database;
  if (!(database instanceof DatabaseSync)) {
    throw new Error(
      'Better Auth is not using the configured local SQLite database.',
    );
  }

  try {
    const migration = await getMigrations(auth.options);
    if (migration.unsafeChanges.length || migration.schemaProblems.length) {
      throw new Error(
        'The existing authentication database has schema conflicts; it was not modified.',
      );
    }

    await migration.runMigrations();

    const tables = database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as Array<{ name: string }>;
    const tableCounts = tables.map(({ name }) => {
      const quotedName = `"${name.replaceAll('"', '""')}"`;
      const result = database
        .prepare(`SELECT COUNT(*) AS count FROM ${quotedName}`)
        .get() as { count: number | bigint };
      return `${name}: ${String(result.count)}`;
    });

    console.log(tableCounts.join('\n') || '0 tables');
  } finally {
    database.close();
  }
}

setupAuthentication().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : 'Authentication setup failed.',
  );
  process.exitCode = 1;
});
