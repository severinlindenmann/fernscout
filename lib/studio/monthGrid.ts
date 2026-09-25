import { weekdayIndex } from "@/lib/studio/dayStrip";

function parseISO(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

/** Clamp an ISO date to the inclusive caller-supplied bounds. */
export function clampDate(date: string, start: string, end: string): string {
  return date < start ? start : date > end ? end : date;
}

/** Complete month, with empty cells padding Monday-first weeks. */
export function monthWindow(anchor: string): (string | null)[] {
  const first = `${anchor.slice(0, 7)}-01`;
  const cursor = parseISO(first);
  const days: (string | null)[] = Array((weekdayIndex(first) + 6) % 7).fill(null);
  while (cursor.toISOString().slice(0, 7) === anchor.slice(0, 7)) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  while (days.length % 7) days.push(null);
  return days;
}

/** Preserve the day where possible; Jan 31 + one month ends in February. */
export function shiftMonth(date: string, months: number): string {
  const cursor = parseISO(date);
  const day = cursor.getUTCDate();
  cursor.setUTCDate(1);
  cursor.setUTCMonth(cursor.getUTCMonth() + months + 1);
  cursor.setUTCDate(0);
  cursor.setUTCDate(Math.min(day, cursor.getUTCDate()));
  return cursor.toISOString().slice(0, 10);
}

export function canShiftMonth(date: string, months: number, start: string, end: string): boolean {
  const month = shiftMonth(date, months).slice(0, 7);
  return month >= start.slice(0, 7) && month <= end.slice(0, 7);
}

/** Keyboard focus movement, independent of selection. */
export function keyboardDate(date: string, key: string, start: string, end: string): string | null {
  if (key === "PageUp" || key === "PageDown") {
    return clampDate(shiftMonth(date, key === "PageUp" ? -1 : 1), start, end);
  }
  const weekday = (weekdayIndex(date) + 6) % 7;
  const offsets: Record<string, number> = {
    ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7,
    Home: -weekday, End: 6 - weekday,
  };
  if (!Object.hasOwn(offsets, key)) return null;
  const cursor = parseISO(date);
  cursor.setUTCDate(cursor.getUTCDate() + offsets[key]);
  return clampDate(cursor.toISOString().slice(0, 10), start, end);
}

/** Today on the device's own calendar, not UTC's. */
export function localToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** The short numeric form a person types: 24.09.2026 (de), 2026.09.24. (hu),
 *  24/09/2026 otherwise. */
export function numericDate(iso: string, locale: string): string {
  const [y, m, d] = iso.split("-");
  if (locale === "de") return `${d}.${m}.${y}`;
  if (locale === "hu") return `${y}.${m}.${d}.`;
  return `${d}/${m}/${y}`;
}

/** ISO for any of `numericDate`'s forms or ISO itself (whatever the locale,
 *  so a pasted date always works); null for anything that is not a real day.
 *  Two-part years are refused: 24.09.26 could be three centuries. */
export function parseTypedDate(text: string): string | null {
  const s = text.trim();
  const ymd = s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})\.?$/);
  const dmy = s.match(/^(\d{1,2})[-./](\d{1,2})[-./](\d{4})$/);
  if (!ymd && !dmy) return null;
  const [y, m, d] = ymd ? [ymd[1], ymd[2], ymd[3]] : [dmy![3], dmy![2], dmy![1]];
  const iso = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  const check = parseISO(iso);
  return !Number.isNaN(check.getTime()) && check.toISOString().slice(0, 10) === iso ? iso : null;
}

/** 1 on the first day, counting calendar days. */
export function dayOfTrip(date: string, start: string): number {
  return Math.round((parseISO(date).getTime() - parseISO(start).getTime()) / 86_400_000) + 1;
}
