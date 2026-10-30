import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isValidRecruitmentDate,
  getRecruitmentDateErrors,
} from '../src/app/recruitment-date';
test('수동 공고 날짜는 실제 달력 날짜와 2000~2100년 범위를 검사한다', () => {
  for (const value of ['2000-02-29', '2024-02-29', '2026-11-30', '2100-12-31'])
    assert.equal(isValidRecruitmentDate(value), true, value);
  for (const value of [
    '',
    '1999-12-31',
    '2101-01-01',
    '2100-02-29',
    '2026-02-29',
    '2026-04-31',
    '2026-13-01',
    '2026-00-01',
    '2026-01-00',
    '2026-1-01',
    '내일',
    '2026-01-01T00:00:00Z',
  ])
    assert.equal(isValidRecruitmentDate(value), false, value);
});

const unchecked = { startDateConfirmed: false, dateConfirmed: false };
test('역전된 기간은 마감일 입력란 오류이며 같은 날과 일부 날짜는 허용한다', () => {
  assert.deepEqual(
    getRecruitmentDateErrors({
      ...unchecked,
      applicationStart: '2026-06-20',
      deadline: '2026-06-19',
    }),
    { deadline: '마감일은 지원 시작일보다 빠를 수 없습니다.' },
  );
  for (const [applicationStart, deadline] of [
    ['2026-06-20', '2026-06-20'],
    ['2026-06-20', ''],
    ['', '2026-06-20'],
    ['', ''],
  ]) {
    assert.deepEqual(
      getRecruitmentDateErrors({ ...unchecked, applicationStart, deadline }),
      {},
    );
  }
});
test('확인한 각 날짜가 없거나 실제 날짜가 아니면 해당 입력란을 지목한다', () => {
  const missing = getRecruitmentDateErrors({
    applicationStart: '',
    deadline: '',
    startDateConfirmed: true,
    dateConfirmed: true,
  });
  assert.ok(missing.applicationStart);
  assert.ok(missing.deadline);
  const invalid = getRecruitmentDateErrors({
    ...unchecked,
    applicationStart: '2026-02-29',
    deadline: '2101-01-01',
  });
  assert.ok(invalid.applicationStart);
  assert.ok(invalid.deadline);
});
