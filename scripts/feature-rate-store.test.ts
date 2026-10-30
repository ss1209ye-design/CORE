import assert from 'node:assert/strict';
import test from 'node:test';
import { loadEnvConfig } from '@next/env';
import { Pool, type PoolClient } from 'pg';
import { createDatabaseConnectionConfig } from '../src/lib/database-tls';
import { consumeFeatureSlot } from '../src/lib/feature-rate-store';

async function isolated(run: (client: PoolClient) => Promise<void>) {
  loadEnvConfig(process.cwd());
  assert.ok(process.env.DATABASE_URL, 'PostgreSQL test requires DATABASE_URL');
  const pool = new Pool(
    createDatabaseConnectionConfig(process.env.DATABASE_URL),
  );
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'CREATE TEMP TABLE "rateLimit" (id text PRIMARY KEY, key text UNIQUE, count integer, "lastRequest" bigint) ON COMMIT DROP',
    );
    await client.query('SET LOCAL search_path TO pg_temp');
    await run(client);
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await pool.end();
  }
}
test('PostgreSQL 요청 제한은 계정별로 분리하고 시간 경계에서 다시 허용한다', async () => {
  await isolated(async (client) => {
    for (let i = 0; i < 5; i++)
      assert.equal(
        (await consumeFeatureSlot(client, 'a', 'ai', 1000 + i * 1000)).allowed,
        true,
      );
    assert.deepEqual(await consumeFeatureSlot(client, 'a', 'ai', 6000), {
      allowed: false,
      retryAfter: 55,
    });
    assert.equal(
      (await consumeFeatureSlot(client, 'b', 'ai', 6000)).allowed,
      true,
    );
    assert.equal(
      (await consumeFeatureSlot(client, 'a', 'ai', 61000)).allowed,
      true,
    );
  });
});
test('요청 종류별 한도를 분리하고 몰린 요청도 한도를 넘지 않는다', async () => {
  await isolated(async (client) => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        consumeFeatureSlot(client, 'a', 'import', 1000),
      ),
    );
    assert.equal(results.filter((r) => r.allowed).length, 10);
    assert.equal(
      (await consumeFeatureSlot(client, 'a', 'ai', 1000)).allowed,
      true,
    );
  });
});
