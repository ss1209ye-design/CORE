import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const originals = [
  [
    'public/brand/piggy-bubble-1.png',
    '694d92ebc87b5e5462a319ca8f45257bfc9b56129effe228b16a7e78ea15a444',
  ],
  [
    'public/brand/piggy-bubble-2.png',
    'af2ed5a5fc1330acc9a8559a13469e8321ddfe6855700a8390acc287dd523c23',
  ],
];
for (const [path, expected] of originals) {
  test(`말풍선 원본 PNG를 변환하지 않는다: ${path}`, () => {
    assert.equal(
      createHash('sha256').update(readFileSync(path)).digest('hex'),
      expected,
    );
  });
}
