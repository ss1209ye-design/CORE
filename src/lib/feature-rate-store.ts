import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

export async function consumeFeatureSlot(
  database: Pool | PoolClient,
  userId: string,
  kind: 'ai' | 'import',
  now = Date.now(),
): Promise<{ allowed: boolean; retryAfter: number }> {
  const windowMs = 60000;
  const maximum = kind === 'ai' ? 5 : 10;
  const id =
    'feature-' + createHash('sha256').update(`${kind}:${userId}`).digest('hex');
  const accepted = await database.query(
    `INSERT INTO "rateLimit" (id, key, count, "lastRequest") VALUES ($1, $1, 1, $2)
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN "rateLimit"."lastRequest" <= $3 THEN 1 ELSE "rateLimit".count + 1 END,
       "lastRequest" = CASE WHEN "rateLimit"."lastRequest" <= $3 THEN EXCLUDED."lastRequest" ELSE "rateLimit"."lastRequest" END
     WHERE "rateLimit"."lastRequest" <= $3 OR "rateLimit".count < $4
     RETURNING count`,
    [id, now, now - windowMs, maximum],
  );
  if (accepted.rowCount) return { allowed: true, retryAfter: 0 };
  const result = await database.query(
    'SELECT "lastRequest" FROM "rateLimit" WHERE key = $1',
    [id],
  );
  return {
    allowed: false,
    retryAfter: Math.max(
      1,
      Math.ceil(
        (Number(result.rows[0]?.lastRequest ?? now) + windowMs - now) / 1000,
      ),
    ),
  };
}
