'use client';

import { useState } from 'react';
import styles from './recruitment-calendar.module.css';
import {
  calendarDateFromDayIndex,
  calendarAgendaPeriod,
  createCalendarWindow,
  deriveCalendarEvents,
  eventsInCalendarMonth,
  eventsOnCalendarDay,
  layoutCalendarEvents,
  recruitmentDateDayIndex,
  type CalendarEvent,
  type RecruitmentCalendarEntry,
} from './recruitment-calendar-layout';

export type { RecruitmentCalendarEntry } from './recruitment-calendar-layout';

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function eventKindLabel(event: CalendarEvent): string {
  if (event.kind === 'range') return '지원 기간';
  return event.kind === 'start' ? '지원 시작일' : '접수 마감일';
}

function deadlineLabel(event: CalendarEvent, todayDay: number | null): string {
  if (!event.deadlineDate) return '지원 시작일 확정';
  const deadlineDay = recruitmentDateDayIndex(event.deadlineDate);
  if (deadlineDay === null || todayDay === null) return '마감일 확인';
  if (deadlineDay < todayDay) return '마감 지남';
  if (deadlineDay === todayDay) return '오늘 마감';
  if (deadlineDay <= todayDay + 7) return '7일 내 마감';
  return '접수 마감';
}

export default function RecruitmentCalendar({
  jobs,
  onOpen,
  onAdd,
}: {
  jobs: RecruitmentCalendarEntry[];
  onOpen: (id: string) => void;
  onAdd: () => void;
}) {
  const today = localDateKey(new Date());
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selectedDate, setSelectedDate] = useState('');
  const calendarWindow = createCalendarWindow(month)!;
  const { events, unscheduled } = deriveCalendarEvents(jobs);
  const monthEvents = eventsInCalendarMonth(events, calendarWindow);
  const displayedEvents = selectedDate
    ? eventsOnCalendarDay(events, selectedDate)
    : monthEvents;
  const weekLayouts = layoutCalendarEvents(events, calendarWindow);
  const todayDay = recruitmentDateDayIndex(today);
  const dueSoonCount = events.filter((event) => {
    if (!event.deadlineDate || event.status === '종료' || todayDay === null) {
      return false;
    }
    const deadlineDay = recruitmentDateDayIndex(event.deadlineDate);
    return (
      deadlineDay !== null &&
      deadlineDay >= todayDay &&
      deadlineDay <= todayDay + 7
    );
  }).length;
  const dayCounts = new Map<number, number>();
  for (const event of events) {
    const start = Math.max(event.startDay, calendarWindow.startDay);
    const end = Math.min(event.endDay, calendarWindow.endDay);
    for (let day = start; day <= end; day++) {
      dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
    }
  }

  function changeMonth(value: string) {
    if (!createCalendarWindow(value)) return;
    setMonth(value);
    setSelectedDate('');
  }

  const selectedLabel = selectedDate
    ? `${selectedDate} 일정`
    : `${calendarWindow.year}년 ${calendarWindow.monthNumber}월 일정`;

  return (
    <section className={styles.root} aria-labelledby="calendar-heading">
      <div className={styles.toolbar}>
        <div className={styles.heading}>
          <h2 id="calendar-heading">피기캘린더</h2>
          <p>
            원문에서 확인한 지원 시작일과 마감일을 월간 일정으로 표시합니다.
          </p>
        </div>
        <div className={styles.navigation}>
          <details
            className={styles.monthPicker}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                event.currentTarget.open = false;
                event.currentTarget.querySelector('summary')?.focus();
              }
            }}
          >
            <summary aria-label="표시할 연월 변경">
              {calendarWindow.year}년 {calendarWindow.monthNumber}월{' '}
              <span aria-hidden="true">▾</span>
            </summary>
            <div className={styles.monthPopover}>
              <label>
                연도
                <select
                  aria-label="표시 연도"
                  value={calendarWindow.year}
                  onChange={(event) =>
                    changeMonth(
                      `${event.target.value}-${String(calendarWindow.monthNumber).padStart(2, '0')}`,
                    )
                  }
                >
                  {Array.from({ length: 101 }, (_, index) => index + 2000).map(
                    (value) => (
                      <option key={value} value={value}>
                        {value}년
                      </option>
                    ),
                  )}
                </select>
              </label>
              <label>
                월
                <select
                  aria-label="표시 월"
                  value={calendarWindow.monthNumber}
                  onChange={(event) =>
                    changeMonth(
                      `${calendarWindow.year}-${event.target.value.padStart(2, '0')}`,
                    )
                  }
                >
                  {Array.from({ length: 12 }, (_, index) => index + 1).map(
                    (value) => (
                      <option key={value} value={value}>
                        {value}월
                      </option>
                    ),
                  )}
                </select>
              </label>
              <button
                type="button"
                className="button small"
                onClick={(event) => {
                  const picker = event.currentTarget.closest('details');
                  if (picker) {
                    picker.open = false;
                    picker.querySelector('summary')?.focus();
                  }
                }}
              >
                확인
              </button>
            </div>
          </details>
          <button
            type="button"
            className={`${styles.addButton} button`}
            aria-label="링크 저장 또는 직접 입력으로 공고 추가"
            title="공고 추가"
            onClick={onAdd}
          >
            +
          </button>
        </div>
      </div>

      <div
        role="group"
        className={styles.calendar}
        aria-label={`${selectedLabel} 달력`}
      >
        <div className={styles.weekdayHeader} aria-hidden="true">
          {['일', '월', '화', '수', '목', '금', '토'].map((day) => (
            <span key={day}>{day}</span>
          ))}
        </div>
        <div className={styles.weeks}>
          {weekLayouts.map((week) => (
            <div
              key={week.startDay}
              role="group"
              className={styles.week}
              aria-label={`${calendarDateFromDayIndex(week.startDay)}부터 시작하는 주간 일정`}
              style={{
                gridTemplateRows: `34px ${Array.from(
                  { length: week.laneCount },
                  () => '24px',
                ).join(' ')}`,
              }}
            >
              {calendarWindow.weeks[week.weekIndex].map((day, column) => {
                const count = dayCounts.get(day.dayIndex) ?? 0;
                return (
                  <button
                    type="button"
                    key={day.date}
                    className={`${styles.dayButton} ${day.inMonth ? '' : styles.adjacentDay} ${day.date === today ? styles.today : ''} ${day.date === selectedDate ? styles.selectedDay : ''}`}
                    aria-label={`${day.date}, 일정 ${count}개`}
                    aria-pressed={selectedDate === day.date}
                    aria-current={day.date === today ? 'date' : undefined}
                    onClick={() => setSelectedDate(day.date)}
                    style={{ gridColumn: column + 1, gridRow: 1 }}
                  >
                    {day.dayOfMonth}
                  </button>
                );
              })}
              {week.segments.map((segment) => {
                const event = segment.event;
                const source = event.organization || event.title;
                const continuation = [
                  segment.continuesBefore ? '이전 주 또는 월에서 이어짐' : '',
                  segment.continuesAfter ? '다음 주 또는 월로 이어짐' : '',
                ]
                  .filter(Boolean)
                  .join(', ');
                return (
                  <button
                    type="button"
                    key={`${event.id}-${segment.startColumn}-${segment.endColumn}`}
                    className={`${styles.eventBar} ${event.status === '종료' ? styles.ended : ''} ${segment.continuesBefore ? styles.continuesBefore : ''} ${segment.continuesAfter ? styles.continuesAfter : ''}`}
                    aria-label={`${source}, ${event.title}, ${eventKindLabel(event)}, ${event.dateLabel}, ${event.status}${continuation ? `, ${continuation}` : ''}`}
                    title={`${source} · ${event.title} · ${eventKindLabel(event)} · ${event.dateLabel} · ${event.status}`}
                    onClick={() => onOpen(event.id)}
                    style={{
                      gridColumn: `${segment.startColumn + 1} / ${segment.endColumn + 2}`,
                      gridRow: segment.lane + 2,
                    }}
                  >
                    <span className={styles.eventLabel}>
                      <span>{source}</span>
                      <small>{event.dateLabel}</small>
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className={styles.summary} aria-label="공고 일정 요약">
        <span>
          관심 공고 <b>{jobs.filter((job) => job.status === '관심').length}</b>
        </span>
        <span>
          다가오는 마감 <b>{dueSoonCount}</b>
          <small> · 7일 이내</small>
        </span>
        <span>
          준비 중 <b>{jobs.filter((job) => job.status === '준비 중').length}</b>
        </span>
        <span>
          일정 미확인 <b>{unscheduled.length}</b>
        </span>
      </div>

      <section
        className={styles.agenda}
        aria-labelledby="calendar-agenda-heading"
      >
        <div className={styles.agendaHeading}>
          <h3 id="calendar-agenda-heading">
            {selectedLabel} 공고 <small>{displayedEvents.length}개</small>
          </h3>
          {selectedDate && (
            <button
              type="button"
              className={styles.textButton}
              onClick={() => setSelectedDate('')}
            >
              이번 달 전체
            </button>
          )}
        </div>
        {!displayedEvents.length && (
          <p className={styles.empty}>
            {jobs.length
              ? '이 기간에 확인된 지원 시작일 또는 마감 일정이 없습니다.'
              : '등록된 공고가 없습니다. 공고를 추가하면 확인된 지원 일정을 볼 수 있습니다.'}
          </p>
        )}
        {displayedEvents.map((event) => (
          <button
            type="button"
            key={event.id}
            className={styles.agendaJob}
            aria-label={`${event.organization}, ${event.title}, ${eventKindLabel(event)}, ${event.dateLabel}, ${event.status}`}
            onClick={() => onOpen(event.id)}
          >
            <span className={styles.agendaDescription}>
              <b>{event.organization}</b>
              <span>{event.title}</span>
              <span className={styles.agendaDates}>
                {calendarAgendaPeriod(event)}
              </span>
              <small>
                {event.status} · {eventKindLabel(event)} ·{' '}
                {deadlineLabel(event, todayDay)}
              </small>
            </span>
          </button>
        ))}
      </section>

      {!!unscheduled.length && (
        <details className={styles.unscheduled}>
          <summary>일정 미확인 공고 {unscheduled.length}개</summary>
          <p>
            지원 시작일과 마감일은 각각 원문에서 확인한 경우에만 일정에
            표시합니다. 역순이거나 유효하지 않은 날짜도 일정에서 제외됩니다.
          </p>
          {unscheduled.map(({ entry, reason }) => (
            <button
              type="button"
              className={styles.agendaJob}
              key={entry.id}
              aria-label={`${entry.organization.trim() || entry.title}, ${entry.title}, ${entry.status}, ${reason}`}
              onClick={() => onOpen(entry.id)}
            >
              <span className={styles.agendaDescription}>
                <b>{entry.organization.trim() || entry.title}</b>
                <span>{entry.title}</span>
                <small>
                  {entry.status} · {reason}
                </small>
              </span>
              <span aria-hidden="true">→</span>
            </button>
          ))}
        </details>
      )}
    </section>
  );
}
