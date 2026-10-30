import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calendarAgendaPeriod,
  createCalendarWindow,
  deriveCalendarEvents,
  eventsInCalendarMonth,
  eventsOnCalendarDay,
  layoutCalendarEvents,
  recruitmentDateDayIndex,
  type RecruitmentCalendarEntry,
} from '../src/app/recruitment-calendar-layout';

function entry(
  overrides: Partial<RecruitmentCalendarEntry> = {},
): RecruitmentCalendarEntry {
  return {
    id: 'job-1',
    title: '지원 공고',
    organization: '회사',
    deadline: '2026-06-10',
    dateConfirmed: false,
    status: '준비 중',
    ...overrides,
  };
}

function day(value: string): number {
  const result = recruitmentDateDayIndex(value);
  assert.notEqual(result, null, `${value} is a valid recruitment date`);
  return result!;
}

test('calendar month windows stay within the 2000–2100 selector bounds', () => {
  assert.ok(createCalendarWindow('2000-01'));
  assert.ok(createCalendarWindow('2100-12'));
  assert.equal(createCalendarWindow('1999-12'), null);
  assert.equal(createCalendarWindow('2101-01'), null);
  assert.equal(createCalendarWindow('2026-13'), null);
});

test('verified start and deadline become one inclusive range event', () => {
  const { events, unscheduled } = deriveCalendarEvents([
    entry({
      applicationStart: '2026-06-08',
      startDateConfirmed: true,
      deadline: '2026-06-10',
      dateConfirmed: true,
    }),
  ]);
  assert.equal(unscheduled.length, 0);
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'range');
  assert.equal(events[0].dateLabel, '2026-06-08–2026-06-10');
  assert.deepEqual(
    ['2026-06-08', '2026-06-09', '2026-06-10'].map((date) =>
      eventsOnCalendarDay(events, date).map((event) => event.id),
    ),
    [['job-1'], ['job-1'], ['job-1']],
  );
  assert.deepEqual(eventsOnCalendarDay(events, '2026-06-11'), []);
});

test('start and deadline confirmations are independent and legacy starts stay hidden', () => {
  const startOnly = deriveCalendarEvents([
    entry({
      id: 'start',
      applicationStart: '2026-07-02',
      startDateConfirmed: true,
      deadline: '2026-07-09',
      dateConfirmed: false,
    }),
  ]);
  assert.equal(startOnly.events[0].kind, 'start');
  assert.equal(startOnly.events[0].dateLabel, '2026-07-02');
  assert.equal(startOnly.events[0].deadlineDate, undefined);

  const deadlineOnly = deriveCalendarEvents([
    entry({
      id: 'deadline',
      applicationStart: '2026-07-01',
      startDateConfirmed: false,
      deadline: '2026-07-09',
      dateConfirmed: true,
    }),
    entry({
      id: 'legacy',
      applicationStart: '2026-07-04',
      deadline: '2026-07-10',
      dateConfirmed: true,
    }),
  ]);
  assert.deepEqual(
    deadlineOnly.events.map(({ id, kind, dateLabel }) => ({
      id,
      kind,
      dateLabel,
    })),
    [
      { id: 'deadline', kind: 'deadline', dateLabel: '2026-07-09' },
      { id: 'legacy', kind: 'deadline', dateLabel: '2026-07-10' },
    ],
  );

  const legacyWithoutDeadline = deriveCalendarEvents([
    entry({
      id: 'legacy-unconfirmed',
      applicationStart: '2026-07-04',
      dateConfirmed: false,
    }),
  ]);
  assert.equal(legacyWithoutDeadline.events.length, 0);
  assert.equal(
    legacyWithoutDeadline.unscheduled[0].entry.id,
    'legacy-unconfirmed',
  );
});

test('invalid dates and reversed confirmed ranges are unscheduled, not repaired', () => {
  const result = deriveCalendarEvents([
    entry({
      id: 'invalid',
      applicationStart: '2026-02-29',
      startDateConfirmed: true,
      deadline: '2026-02-30',
      dateConfirmed: true,
    }),
    entry({
      id: 'reversed',
      applicationStart: '2026-08-11',
      startDateConfirmed: true,
      deadline: '2026-08-10',
      dateConfirmed: true,
    }),
  ]);
  assert.equal(result.events.length, 0);
  assert.deepEqual(
    result.unscheduled.map(({ entry: item, reason }) => [item.id, reason]),
    [
      ['invalid', '확인한 날짜가 유효하지 않습니다.'],
      ['reversed', '지원 시작일이 마감일보다 늦습니다.'],
    ],
  );
});

test('leap days and Sunday-to-Saturday intervals use inclusive UTC day indices', () => {
  const leap = deriveCalendarEvents([
    entry({
      applicationStart: '2024-02-28',
      startDateConfirmed: true,
      deadline: '2024-03-01',
      dateConfirmed: true,
    }),
  ]);
  const february = createCalendarWindow('2024-02')!;
  assert.ok(february.weeks.flat().some((item) => item.date === '2024-02-29'));
  assert.deepEqual(
    eventsOnCalendarDay(leap.events, '2024-02-29').map((event) => event.id),
    ['job-1'],
  );

  const sunday = deriveCalendarEvents([
    entry({
      applicationStart: '2026-11-01',
      startDateConfirmed: true,
      deadline: '2026-11-07',
      dateConfirmed: true,
    }),
  ]);
  const november = createCalendarWindow('2026-11')!;
  assert.equal(november.weeks[0][0].date, '2026-11-01');
  const firstWeek = layoutCalendarEvents(sunday.events, november)[0];
  assert.deepEqual(
    firstWeek.segments.map(({ startColumn, endColumn }) => [
      startColumn,
      endColumn,
    ]),
    [[0, 6]],
  );
  assert.equal(firstWeek.segments[0].continuesBefore, false);
  assert.equal(firstWeek.segments[0].continuesAfter, false);
  assert.equal(new Date(day('2026-11-01') * 86_400_000).getUTCDay(), 0);
});

test('month intersection and week/month clipping preserve a Dec-Jan continuation', () => {
  const { events } = deriveCalendarEvents([
    entry({
      applicationStart: '2026-12-30',
      startDateConfirmed: true,
      deadline: '2027-01-02',
      dateConfirmed: true,
    }),
    entry({
      id: 'prior-month',
      applicationStart: '2026-11-29',
      startDateConfirmed: true,
      deadline: '2027-01-03',
      dateConfirmed: true,
    }),
  ]);
  const december = createCalendarWindow('2026-12')!;
  const january = createCalendarWindow('2027-01')!;
  const decemberEvents = eventsInCalendarMonth(events, december);
  assert.deepEqual(
    decemberEvents.map((event) => event.id),
    ['prior-month', 'job-1'],
  );
  assert.deepEqual(
    eventsInCalendarMonth(events, january).map((event) => event.id),
    ['prior-month', 'job-1'],
  );
  assert.deepEqual(
    eventsInCalendarMonth(events, createCalendarWindow('2026-10')!),
    [],
  );

  const segments = layoutCalendarEvents(events, december).flatMap(
    (week) => week.segments,
  );
  const crossing = segments.filter((segment) => segment.event.id === 'job-1');
  assert.deepEqual(
    crossing.map(
      ({ event, startColumn, endColumn, continuesBefore, continuesAfter }) => ({
        id: event.id,
        startColumn,
        endColumn,
        continuesBefore,
        continuesAfter,
      }),
    ),
    [
      {
        id: 'job-1',
        startColumn: 3,
        endColumn: 4,
        continuesBefore: false,
        continuesAfter: true,
      },
      {
        id: 'job-1',
        startColumn: 5,
        endColumn: 6,
        continuesBefore: true,
        continuesAfter: false,
      },
    ],
  );

  const monthBoundary = deriveCalendarEvents([
    entry({
      id: 'boundary',
      applicationStart: '2026-12-31',
      startDateConfirmed: true,
      deadline: '2027-01-02',
      dateConfirmed: true,
    }),
  ]);
  const boundarySegments = layoutCalendarEvents(
    monthBoundary.events,
    december,
  ).flatMap((week) => week.segments);
  assert.deepEqual(
    boundarySegments.map(
      ({ startColumn, endColumn, continuesBefore, continuesAfter }) => ({
        startColumn,
        endColumn,
        continuesBefore,
        continuesAfter,
      }),
    ),
    [
      {
        startColumn: 4,
        endColumn: 4,
        continuesBefore: false,
        continuesAfter: true,
      },
      {
        startColumn: 5,
        endColumn: 6,
        continuesBefore: true,
        continuesAfter: false,
      },
    ],
  );
  assert.ok(
    boundarySegments.every(
      (segment) => segment.event.dateLabel === '2026-12-31–2027-01-02',
    ),
  );
});

test('overlapping jobs occupy different lanes while non-overlapping jobs may reuse one', () => {
  const { events } = deriveCalendarEvents([
    entry({
      id: 'a',
      applicationStart: '2026-01-04',
      startDateConfirmed: true,
      deadline: '2026-01-06',
      dateConfirmed: true,
    }),
    entry({
      id: 'b',
      applicationStart: '2026-01-06',
      startDateConfirmed: true,
      deadline: '2026-01-08',
      dateConfirmed: true,
    }),
    entry({
      id: 'c',
      applicationStart: '2026-01-09',
      startDateConfirmed: true,
      deadline: '2026-01-10',
      dateConfirmed: true,
    }),
  ]);
  const week = layoutCalendarEvents(
    events,
    createCalendarWindow('2026-01')!,
  )[1];
  const byId = new Map(
    week.segments.map((segment) => [segment.event.id, segment]),
  );
  assert.notEqual(byId.get('a')?.lane, byId.get('b')?.lane);
  assert.equal(byId.get('c')?.lane, byId.get('a')?.lane);
  for (const left of week.segments) {
    for (const right of week.segments) {
      if (left === right || left.lane !== right.lane) continue;
      assert.ok(
        left.endColumn < right.startColumn ||
          left.startColumn > right.endColumn,
        `${left.event.id} and ${right.event.id} must not collide in lane ${left.lane}`,
      );
    }
  }
});

test('event and lane order are deterministic regardless of input order', () => {
  const jobs = [
    entry({
      id: 'z',
      title: '공고 Z',
      applicationStart: '2026-04-05',
      startDateConfirmed: true,
      deadline: '2026-04-10',
      dateConfirmed: true,
    }),
    entry({
      id: 'a',
      title: '공고 A',
      applicationStart: '2026-04-05',
      startDateConfirmed: true,
      deadline: '2026-04-08',
      dateConfirmed: true,
    }),
    entry({
      id: 'm',
      title: '공고 M',
      applicationStart: '2026-04-07',
      startDateConfirmed: true,
      deadline: '2026-04-09',
      dateConfirmed: true,
    }),
  ];
  const first = deriveCalendarEvents(jobs).events;
  const second = deriveCalendarEvents([...jobs].reverse()).events;
  assert.deepEqual(
    first.map((event) => event.id),
    ['a', 'z', 'm'],
  );
  assert.deepEqual(
    second.map((event) => event.id),
    first.map((event) => event.id),
  );
  const window = createCalendarWindow('2026-04')!;
  const project = (events: typeof first) =>
    layoutCalendarEvents(events, window).map((week) =>
      week.segments.map((segment) => [
        segment.event.id,
        segment.startColumn,
        segment.endColumn,
        segment.lane,
      ]),
    );
  assert.deepEqual(project(first), project(second));
});

test('current props are re-derived after an entry is edited or deleted', () => {
  const original = entry({
    applicationStart: '2026-05-01',
    startDateConfirmed: true,
    deadline: '2026-05-04',
    dateConfirmed: true,
  });
  const before = deriveCalendarEvents([original]);
  assert.equal(before.events[0].dateLabel, '2026-05-01–2026-05-04');

  const edited = {
    ...original,
    applicationStart: '2026-05-10',
    deadline: '2026-05-12',
  };
  const afterEdit = deriveCalendarEvents([edited]);
  assert.equal(afterEdit.events.length, 1);
  assert.equal(afterEdit.events[0].dateLabel, '2026-05-10–2026-05-12');
  assert.equal(eventsOnCalendarDay(afterEdit.events, '2026-05-02').length, 0);
  assert.equal(deriveCalendarEvents([]).events.length, 0);
  assert.equal(deriveCalendarEvents([]).unscheduled.length, 0);
});

test('selected-day agenda includes inclusive overlapping ranges and preserves their full periods', () => {
  const { events } = deriveCalendarEvents([
    entry({
      id: 'a',
      applicationStart: '2026-10-26',
      deadline: '2026-10-29',
      startDateConfirmed: true,
      dateConfirmed: true,
    }),
    entry({
      id: 'b',
      applicationStart: '2026-10-29',
      deadline: '2026-11-02',
      startDateConfirmed: true,
      dateConfirmed: true,
    }),
    entry({
      id: 'outside',
      applicationStart: '2026-10-30',
      deadline: '2026-11-01',
      startDateConfirmed: true,
      dateConfirmed: true,
    }),
  ]);
  assert.deepEqual(
    eventsOnCalendarDay(events, '2026-10-29').map((e) => [
      e.id,
      calendarAgendaPeriod(e),
    ]),
    [
      ['a', '지원 기간: 10-26 ~ 10-29'],
      ['b', '지원 기간: 10-29 ~ 11-02'],
    ],
  );
});
test('agenda periods retain both years across New Year and do not invent a missing endpoint', () => {
  const { events } = deriveCalendarEvents([
    entry({
      id: 'cross',
      applicationStart: '2026-12-28',
      deadline: '2027-01-03',
      startDateConfirmed: true,
      dateConfirmed: true,
    }),
    entry({
      id: 'start',
      applicationStart: '2026-12-28',
      deadline: '',
      startDateConfirmed: true,
      dateConfirmed: false,
    }),
    entry({
      id: 'end',
      applicationStart: '',
      deadline: '2027-01-03',
      startDateConfirmed: false,
      dateConfirmed: true,
    }),
  ]);
  assert.equal(
    calendarAgendaPeriod(events.find((e) => e.id === 'cross')!),
    '지원 기간: 2026-12-28 ~ 2027-01-03',
  );
  assert.equal(
    calendarAgendaPeriod(events.find((e) => e.id === 'start')!),
    '지원 시작일: 2026-12-28',
  );
  assert.equal(
    calendarAgendaPeriod(events.find((e) => e.id === 'end')!),
    '마감일: 2027-01-03',
  );
});
