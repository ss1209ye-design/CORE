import { Pool } from 'pg';
import { createDatabaseConnectionConfig } from './database-tls';

const globalForDatabase = globalThis as typeof globalThis & {
  authDatabase?: { url: string; pool: Pool };
};

export function getAuthDatabase(): Pool {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error('DATABASE_URL is required for authentication.');
  const existing = globalForDatabase.authDatabase;
  if (existing) {
    if (existing.url !== url)
      throw new Error('Restart to apply database configuration changes.');
    return existing.pool;
  }
  const pool = new Pool(createDatabaseConnectionConfig(url));
  pool.on('error', () =>
    console.error('Authentication database connection error.'),
  );
  globalForDatabase.authDatabase = { url, pool };
  return pool;
}
