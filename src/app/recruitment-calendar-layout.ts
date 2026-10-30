import { isValidRecruitmentDate } from './recruitment-date';

export type RecruitmentCalendarEntry = {
  id: string;
  title: string;
  organization: string;
  deadline: string;
  dateConfirmed: boolean;
  status: string;
  applicationStart?: string;
  startDateConfirmed?: boolean;
};

export type CalendarEventKind = 'range' | 'start' | 'deadline';

export type CalendarEvent = {
  id: string;
  title: string;
  organization: string;
  status: string;
  kind: CalendarEventKind;
  startDate: string;
  endDate: string;
  dateLabel: string;
  startDay: number;
  endDay: number;
  deadlineDate?: string;
};

export type UnscheduledCalendarEntry = {
  entry: RecruitmentCalendarEntry;
  reason: string;
};

export type CalendarWindowDay = {
  date: string;
  dayIndex: number;
  dayOfMonth: number;
  inMonth: boolean;
};

export type CalendarWindow = {
  month: string;
  year: number;
  monthNumber: number;
  monthStartDay: number;
  monthEndDay: number;
  startDay: number;
  endDay: number;
  weeks: CalendarWindowDay[][];
};

export type CalendarSegment = {
  event: CalendarEvent;
  weekIndex: number;
  startColumn: number;
  endColumn: number;
  lane: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
};

export type CalendarWeekLayout = {
  weekIndex: number;
  startDay: number;
  segments: CalendarSegment[];
  laneCount: number;
};

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function recruitmentDateDayIndex(value: string): number | null {
  if (!isValidRecruitmentDate(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  return Date.UTC(year, month - 1, day) / 86_400_000;
}

export function calendarDateFromDayIndex(dayIndex: number): string {
  return new Date(dayIndex * 86_400_000).toISOString().slice(0, 10);
}

function compareEvents(a: CalendarEvent, b: CalendarEvent): number {
  return (
    compareText(a.startDate, b.startDate) ||
    compareText(a.endDate, b.endDate) ||
    compareText(a.organization, b.organization) ||
    compareText(a.title, b.title) ||
    compareText(a.id, b.id) ||
    compareText(a.kind, b.kind)
  );
}

function makeEvent(
  entry: RecruitmentCalendarEntry,
  kind: CalendarEventKind,
  startDate: string,
  endDate: string,
): CalendarEvent {
  const startDay = recruitmentDateDayIndex(startDate);
  const endDay = recruitmentDateDayIndex(endDate);
  if (startDay === null || endDay === null) {
    throw new Error('Calendar events require validated dates');
  }
  return {
    id: entry.id,
    title: entry.title,
    organization: entry.organization.trim() || entry.title,
    status: entry.status,
    kind,
    startDate,
    endDate,
    dateLabel: startDate === endDate ? startDate : `${startDate}–${endDate}`,
    startDay,
    endDay,
    ...(kind === 'range' || kind === 'deadline'
      ? { deadlineDate: endDate }
      : {}),
  };
}

export function deriveCalendarEvents(entries: RecruitmentCalendarEntry[]): {
  events: CalendarEvent[];
  unscheduled: UnscheduledCalendarEntry[];
} {
  const events: CalendarEvent[] = [];
  const unscheduled: UnscheduledCalendarEntry[] = [];

  for (const entry of entries) {
    const startConfirmed = entry.startDateConfirmed === true;
    const deadlineConfirmed = entry.dateConfirmed === true;
    const applicationStart = entry.applicationStart ?? '';
    const startDay = startConfirmed
      ? recruitmentDateDayIndex(applicationStart)
      : null;
    const deadlineDay = deadlineConfirmed
      ? recruitmentDateDayIndex(entry.deadline)
      : null;

    if (startDay !== null && deadlineDay !== null) {
      if (startDay > deadlineDay) {
        unscheduled.push({
          entry,
          reason: '지원 시작일이 마감일보다 늦습니다.',
        });
        continue;
      }
      events.push(makeEvent(entry, 'range', applicationStart, entry.deadline));
      continue;
    }

    if (startDay !== null) {
      events.push(
        makeEvent(entry, 'start', applicationStart, applicationStart),
      );
      continue;
    }

    if (deadlineDay !== null) {
      events.push(makeEvent(entry, 'deadline', entry.deadline, entry.deadline));
      continue;
    }

    const hasConfirmedInvalidDate =
      (startConfirmed && startDay === null) ||
      (deadlineConfirmed && deadlineDay === null);
    unscheduled.push({
      entry,
      reason: hasConfirmedInvalidDate
        ? '확인한 날짜가 유효하지 않습니다.'
        : '원문에서 확인한 일정이 없습니다.',
    });
  }

  events.sort(compareEvents);
  unscheduled.sort(
    (a, b) =>
      compareText(a.entry.title, b.entry.title) ||
      compareText(a.entry.organization, b.entry.organization) ||
      compareText(a.entry.id, b.entry.id),
  );
  return { events, unscheduled };
}

export function createCalendarWindow(month: string): CalendarWindow | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null;
  const [year, monthNumber] = month.split('-').map(Number);
  if (!isValidRecruitmentDate(`${month}-01`)) return null;

  const monthStartDay = recruitmentDateDayIndex(`${month}-01`);
  if (monthStartDay === null) return null;
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const monthEndDay = monthStartDay + daysInMonth - 1;
  const firstWeekday = new Date(monthStartDay * 86_400_000).getUTCDay();
  const weekCount = Math.ceil((firstWeekday + daysInMonth) / 7);
  const startDay = monthStartDay - firstWeekday;
  const weeks = Array.from({ length: weekCount }, (_, weekIndex) =>
    Array.from({ length: 7 }, (_, column) => {
      const dayIndex = startDay + weekIndex * 7 + column;
      const date = calendarDateFromDayIndex(dayIndex);
      return {
        date,
        dayIndex,
        dayOfMonth: Number(date.slice(8)),
        inMonth: dayIndex >= monthStartDay && dayIndex <= monthEndDay,
      };
    }),
  );

  return {
    month,
    year,
    monthNumber,
    monthStartDay,
    monthEndDay,
    startDay,
    endDay: startDay + weekCount * 7 - 1,
    weeks,
  };
}

export function eventsInCalendarMonth(
  events: CalendarEvent[],
  window: CalendarWindow,
): CalendarEvent[] {
  return events
    .filter(
      (event) =>
        event.startDay <= window.monthEndDay &&
        event.endDay >= window.monthStartDay,
    )
    .sort(compareEvents);
}

export function eventsOnCalendarDay(
  events: CalendarEvent[],
  date: string,
): CalendarEvent[] {
  const dayIndex = recruitmentDateDayIndex(date);
  if (dayIndex === null) return [];
  return events
    .filter((event) => event.startDay <= dayIndex && event.endDay >= dayIndex)
    .sort(compareEvents);
}

export function layoutCalendarEvents(
  events: CalendarEvent[],
  window: CalendarWindow,
): CalendarWeekLayout[] {
  const weeks: CalendarWeekLayout[] = window.weeks.map((days, weekIndex) => ({
    weekIndex,
    startDay: days[0].dayIndex,
    segments: [],
    laneCount: 0,
  }));
  const orderedEvents = [...events].sort(compareEvents);

  for (const event of orderedEvents) {
    const visibleStart = Math.max(event.startDay, window.startDay);
    const visibleEnd = Math.min(event.endDay, window.endDay);
    if (visibleStart > visibleEnd) continue;

    for (const week of weeks) {
      const weekStart = week.startDay;
      const weekEnd = weekStart + 6;
      let cursor = Math.max(visibleStart, weekStart);
      const lastVisibleDay = Math.min(visibleEnd, weekEnd);
      while (cursor <= lastVisibleDay) {
        let pieceEnd: number;
        if (cursor < window.monthStartDay) {
          pieceEnd = Math.min(lastVisibleDay, window.monthStartDay - 1);
        } else if (cursor <= window.monthEndDay) {
          pieceEnd = Math.min(lastVisibleDay, window.monthEndDay);
        } else {
          pieceEnd = lastVisibleDay;
        }
        week.segments.push({
          event,
          weekIndex: week.weekIndex,
          startColumn: cursor - weekStart,
          endColumn: pieceEnd - weekStart,
          lane: -1,
          continuesBefore: event.startDay < cursor,
          continuesAfter: event.endDay > pieceEnd,
        });
        cursor = pieceEnd + 1;
      }
    }
  }

  for (const week of weeks) {
    week.segments.sort(
      (a, b) =>
        a.startColumn - b.startColumn ||
        b.endColumn - a.endColumn ||
        compareEvents(a.event, b.event),
    );
    const laneSegments: CalendarSegment[][] = [];
    for (const segment of week.segments) {
      let lane = laneSegments.findIndex((segments) =>
        segments.every(
          (placed) =>
            segment.endColumn < placed.startColumn ||
            segment.startColumn > placed.endColumn,
        ),
      );
      if (lane === -1) {
        lane = laneSegments.length;
        laneSegments.push([]);
      }
      segment.lane = lane;
      laneSegments[lane].push(segment);
    }
    week.laneCount = laneSegments.length;
    week.segments.sort(
      (a, b) =>
        a.lane - b.lane ||
        a.startColumn - b.startColumn ||
        compareEvents(a.event, b.event),
    );
  }

  return weeks;
}

export function calendarAgendaPeriod(event: CalendarEvent): string {
  if (event.kind === 'start') return '지원 시작일: ' + event.startDate;
  if (event.kind === 'deadline') return '마감일: ' + event.endDate;
  const sameYear = event.startDate.slice(0, 4) === event.endDate.slice(0, 4);
  const start = sameYear ? event.startDate.slice(5) : event.startDate;
  const end = sameYear ? event.endDate.slice(5) : event.endDate;
  return '지원 기간: ' + start + ' ~ ' + end;
}
