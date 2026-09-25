/**
 * Pure date-window arithmetic for `DayStrip` (`components/studio/day/DayStrip.tsx`)
 * — no React, no filesystem, so it is unit-tested directly
 * (`test/day-strip-window.test.ts`) rather than only through the component
 * that renders it.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function parseISO(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function toISO(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  return toISO(new Date(parseISO(date).getTime() + days * DAY_MS));
}

/** 0 (Sunday) – 6 (Saturday), the same index `weekdayNames` (`lib/i18n.ts`)
 *  is keyed by. */
export function weekdayIndex(date: string): number {
  return parseISO(date).getUTCDay();
}

/** The Monday-to-Sunday week containing `anchor`, as seven ISO dates. */
export function weekDates(anchor: string): string[] {
  const dow = weekdayIndex(anchor);
  const isoWeekday = dow === 0 ? 7 : dow; // 1=Mon .. 7=Sun
  const monday = addDays(anchor, 1 - isoWeekday);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** `weeks` whole weeks from the week containing `anchor` — always a step of
 *  seven days, so paging repeatedly lands on the same weekday each time. */
export function shiftWeek(anchor: string, weeks: number): string {
  return addDays(anchor, weeks * 7);
}

/** Whether paging `weeks` further from `anchor` could still land on a date
 *  inside `[start, end]` — used to disable the strip's own prev/next
 *  controls at the edges instead of paging into an empty week. */
export function canShiftWeek(anchor: string, weeks: number, start: string, end: string): boolean {
  return weekDates(shiftWeek(anchor, weeks)).some((d) => d >= start && d <= end);
}

/** A date outside `[start, end]` cannot be chosen — before the trip's own
 *  start, or after whatever upper bound the caller passes (today, at the
 *  "which day" step). */
export function isOutOfRange(date: string, start: string, end: string): boolean {
  return date < start || date > end;
}
