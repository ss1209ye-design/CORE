import assert from 'node:assert/strict';
import test from 'node:test';
import { guideTarget } from '../src/app/piggy-guide-content';

test('안내의 두 실제 작성 화면만 이동 대상으로 허용한다', () => {
  assert.equal(guideTarget('job'), 'job');
  assert.equal(guideTarget('experience'), 'experience');
});
test('외부 주소와 조작된 이동 대상은 거절한다', () => {
  for (const input of [
    undefined,
    null,
    '',
    'https://evil.example',
    '//evil.example',
    'javascript:alert(1)',
    '../admin',
    ['job'],
    { next: 'job' },
    'JOB',
  ]) {
    assert.equal(guideTarget(input), null);
  }
});
