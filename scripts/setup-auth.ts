import { mkdir, chmod } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';
import { loadEnvConfig } from '@next/env';
import { Pool } from 'pg';
import { getMigrations } from 'better-auth/db/migration';
import { createAuth } from '../src/lib/auth-core';
import { readAuthConfiguration } from '../src/lib/auth-config';
import { createDatabaseConnectionConfig } from '../src/lib/database-tls';

const tables = [
  'user',
  'account',
  'session',
  'verification',
  'rateLimit',
] as const;
const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';

async function main() {
  loadEnvConfig(process.cwd());
  const configuration = readAuthConfiguration();
  if (!configuration || !process.env.DIRECT_URL)
    throw new Error('Missing configuration');
  const pool = new Pool(createDatabaseConnectionConfig(process.env.DIRECT_URL));
  let source: DatabaseSync | undefined;
  try {
    const auth = createAuth(configuration, pool);
    const migration = await getMigrations(auth.options);
    if (migration.unsafeChanges.length || migration.schemaProblems.length)
      throw new Error('Schema conflicts');
    const sql = await migration.compileMigrations();
    if (!process.argv.includes('--apply')) {
      console.log(sql || 'Authentication schema is current.');
      console.log(
        'Preview only. --apply creates schema; --from-sqlite also copies the existing account database.',
      );
      return;
    }
    const importing = process.argv.includes('--from-sqlite');
    if (importing) {
      const sourcePath = resolve(
        process.env.BETTER_AUTH_DATABASE_PATH || '.data/auth.sqlite',
      );
      source = new DatabaseSync(sourcePath, { readOnly: true });
      const backupDirectory = resolve('.data/auth-backups');
      await mkdir(backupDirectory, { recursive: true, mode: 0o700 });
      const destination = resolve(backupDirectory, `auth-${Date.now()}.sqlite`);
      await backup(source, destination);
      await chmod(destination, 0o600);
      source.exec('BEGIN');
      console.log(
        'Consistent private SQLite backup created; original database retained.',
      );
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(73194628)');
      if (sql.trim()) await client.query(sql);
      for (const table of tables) {
        await client.query(
          `ALTER TABLE ${quote(table)} ENABLE ROW LEVEL SECURITY`,
        );
        await client.query(
          `REVOKE ALL ON TABLE ${quote(table)} FROM anon, authenticated`,
        );
        if (!source) continue;
        const count = await client.query(
          `SELECT count(*) AS n FROM ${quote(table)}`,
        );
        if (Number(count.rows[0].n) !== 0)
          throw new Error('Destination is not empty; refusing to overwrite');
        const columns = source
          .prepare(`PRAGMA table_info(${quote(table)})`)
          .all() as Array<{ name: string; type: string }>;
        const rows = source.prepare(`SELECT * FROM ${quote(table)}`).all();
        const converted = rows.map((row) =>
          columns.map((column) => {
            const value = row[column.name];
            if (value === null) return null;
            if (
              /bool/i.test(column.type) ||
              (table === 'user' &&
                ['emailVerified', 'guideCompleted'].includes(column.name))
            )
              return Boolean(value);
            if (/date/i.test(column.type)) {
              const date = new Date(
                typeof value === 'number'
                  ? value
                  : /^\d+$/.test(String(value))
                    ? Number(value)
                    : String(value),
              );
              if (!Number.isFinite(date.getTime()))
                throw new Error('Invalid source date');
              return date;
            }
            return value;
          }),
        );
        for (const values of converted) {
          await client.query(
            `INSERT INTO ${quote(table)} (${columns.map((c) => quote(c.name)).join(',')}) VALUES (${columns.map((_, i) => '$' + (i + 1)).join(',')})`,
            values,
          );
        }
        const copied = await client.query(`SELECT * FROM ${quote(table)}`);
        if (copied.rowCount !== rows.length)
          throw new Error('Row count mismatch');
        for (const values of converted) {
          const id = values[columns.findIndex((c) => c.name === 'id')];
          const row = copied.rows.find((r) => r.id === id);
          if (!row) throw new Error('Account identity mismatch');
          columns.forEach((column, index) => {
            const expected = values[index];
            const actual = row[column.name];
            const same =
              expected instanceof Date
                ? actual instanceof Date &&
                  actual.getTime() === expected.getTime()
                : expected === null
                  ? actual === null
                  : String(actual) === String(expected);
            if (!same) throw new Error('Copied data mismatch');
          });
        }
        console.log(
          `${table}: ${rows.length} rows verified without displaying account data.`,
        );
      }
      await client.query(
        'CREATE TABLE IF NOT EXISTS workspace ("userId" text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE, data jsonb NOT NULL, revision integer NOT NULL CHECK(revision>0), imports text[] NOT NULL DEFAULT ARRAY[]::text[])',
      );
      await client.query(
        'ALTER TABLE workspace ENABLE ROW LEVEL SECURITY; REVOKE ALL ON workspace FROM anon, authenticated',
      );
      await client.query('COMMIT');
      console.log(
        'PostgreSQL authentication schema ready; RLS enabled and public API roles denied.',
      );
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } finally {
    if (source) {
      source.exec('ROLLBACK');
      source.close();
    }
    await pool.end();
  }
}
main().catch((error: unknown) => {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String(error.code)
      : 'VALIDATION_FAILED';
  console.error(
    'Migration failure code:',
    /^[A-Z0-9_]+$/.test(code) ? code : 'UNKNOWN',
  );
  console.error(
    'Authentication setup failed. No partial database transaction was committed; source SQLite is preserved. Connection details and account data are withheld.',
  );
  process.exitCode = 1;
});
