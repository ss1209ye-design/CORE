import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export function consumeFeatureSlot(
  database: DatabaseSync,
  userId: string,
  kind: 'ai' | 'import',
  now = Date.now(),
): { allowed: boolean; retryAfter: number } {
  const windowMs = 60000;
  const maximum = kind === 'ai' ? 5 : 10;
  const id =
    'feature-' + createHash('sha256').update(`${kind}:${userId}`).digest('hex');
  const accepted = database
    .prepare(
      `
    INSERT INTO rateLimit (id, key, count, lastRequest) VALUES (?, ?, 1, ?)
    ON CONFLICT(id) DO UPDATE SET
      count = CASE WHEN lastRequest <= ? THEN 1 ELSE count + 1 END,
      lastRequest = CASE WHEN lastRequest <= ? THEN excluded.lastRequest ELSE lastRequest END
    WHERE lastRequest <= ? OR count < ?
    RETURNING count
  `,
    )
    .get(id, id, now, now - windowMs, now - windowMs, now - windowMs, maximum);
  if (accepted) return { allowed: true, retryAfter: 0 };
  const row = database
    .prepare('SELECT lastRequest FROM rateLimit WHERE id = ?')
    .get(id);
  return {
    allowed: false,
    retryAfter: Math.max(
      1,
      Math.ceil((Number(row?.lastRequest ?? now) + windowMs - now) / 1000),
    ),
  };
}
