import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { consumeFeatureSlot } from '../src/lib/feature-rate-store';
function database() {
  const db = new DatabaseSync(':memory:');
  db.exec(
    'CREATE TABLE rateLimit (id TEXT PRIMARY KEY, key TEXT, count INTEGER, lastRequest INTEGER)',
  );
  return db;
}
test('AI 제한은 사용자별 5회이며 거절 요청은 창을 연장하지 않는다', () => {
  const db = database();
  try {
    for (let i = 0; i < 5; i++)
      assert.equal(
        consumeFeatureSlot(db, 'synthetic-a', 'ai', 1000 + i * 1000).allowed,
        true,
      );
    assert.deepEqual(consumeFeatureSlot(db, 'synthetic-a', 'ai', 6000), {
      allowed: false,
      retryAfter: 55,
    });
    assert.equal(
      consumeFeatureSlot(db, 'synthetic-b', 'ai', 6000).allowed,
      true,
    );
    assert.equal(
      consumeFeatureSlot(db, 'synthetic-a', 'ai', 61000).allowed,
      true,
    );
  } finally {
    db.close();
  }
});
test('URL 수집과 AI 한도는 분리되고 URL은 10회 제한이다', () => {
  const db = database();
  try {
    for (let i = 0; i < 10; i++)
      assert.equal(
        consumeFeatureSlot(db, 'synthetic', 'import', 1000).allowed,
        true,
      );
    assert.equal(
      consumeFeatureSlot(db, 'synthetic', 'import', 1000).allowed,
      false,
    );
    assert.equal(consumeFeatureSlot(db, 'synthetic', 'ai', 1000).allowed, true);
  } finally {
    db.close();
  }
});
