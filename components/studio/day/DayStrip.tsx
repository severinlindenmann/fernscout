"use client";

import { useState } from "react";
import { useI18n } from "@/components/LocaleProvider";
import { weekdayNames } from "@/lib/i18n";
import { canShiftWeek, isOutOfRange, shiftWeek, weekDates, weekdayIndex } from "@/lib/studio/dayStrip";

/**
 * B1989 — the week strip the "which day" step shows instead of a bare
 * native `<input type="date">`. Pure props, no fetch of its own: `start`/
 * `end` are just a bound, `writtenDates` is just a set of ISO dates, so the
 * component carries no opinion about what those bounds mean. B1990 reuses it
 * unchanged for moving an inbox photograph onto a day, with its own bound
 * set and its own written-dates source.
 *
 * The native date field stays reachable behind a `<details>` disclosure at
 * the call site (`AddDayFlow.tsx`) — this component only ever writes a date
 * that is inside `[start, end]`, so the two controls can share one `value`/
 * `onChange` pair without either one fighting the other's idea of what is
 * choosable.
 */
export default function DayStrip({
  value,
  onChange,
  start,
  end,
  writtenDates,
}: {
  /** Selected date, ISO `yyyy-mm-dd`, or `""` for none yet. */
  value: string;
  onChange: (date: string) => void;
  /** Earliest choosable date, inclusive. */
  start: string;
  /** Latest choosable date, inclusive — "today" at the "which day" step, but
   *  the strip itself has no opinion about what the bound means. */
  end: string;
  /** ISO dates that already have a day written, for the entry mark. */
  writtenDates: string[] | Set<string>;
}) {
  const { t, locale, formatLongDate } = useI18n();
  const written = writtenDates instanceof Set ? writtenDates : new Set(writtenDates);
  const weekdays = weekdayNames(locale);

  const [anchor, setAnchor] = useState(() => value || end);
  // Tracks the last `value` this component has reacted to, so a change can
  // be caught during render — React's own "adjusting state when a prop
  // changes" pattern — instead of in a `useEffect`, which would commit the
  // stale week first and only fix it a render later.
  const [trackedValue, setTrackedValue] = useState(value);

  if (value !== trackedValue) {
    setTrackedValue(value);
    // The native date field behind the disclosure writes this same `value`
    // — when it lands outside the visible week, follow it rather than leave
    // the strip pointing somewhere else.
    if (value && !weekDates(anchor).includes(value)) setAnchor(value);
  }

  const days = weekDates(anchor);

  return (
    <div className="mt-1">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setAnchor(shiftWeek(anchor, -1))}
          disabled={!canShiftWeek(anchor, -1, start, end)}
          aria-label={t("studio.day.strip.prevWeek")}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-line-strong text-ink-body hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
        >
          <span aria-hidden="true">‹</span>
        </button>
        <button
          type="button"
          onClick={() => setAnchor(shiftWeek(anchor, 1))}
          disabled={!canShiftWeek(anchor, 1, start, end)}
          aria-label={t("studio.day.strip.nextWeek")}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-line-strong text-ink-body hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
        >
          <span aria-hidden="true">›</span>
        </button>
      </div>

      <div className="mt-2 grid grid-cols-7 gap-1">
        {days.map((date) => {
          const dayNumber = Number(date.slice(8, 10));
          const selected = date === value;
          const isToday = date === end && !isOutOfRange(date, start, end);
          const hasEntry = written.has(date);
          const disabled = isOutOfRange(date, start, end);

          const label = hasEntry
            ? t("studio.day.strip.dayWithEntry", { date: formatLongDate(date) })
            : formatLongDate(date);

          return (
            <button
              key={date}
              type="button"
              aria-pressed={selected}
              aria-current={isToday ? "date" : undefined}
              aria-label={label}
              disabled={disabled}
              onClick={() => onChange(date)}
              className={[
                "flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl border px-1 py-2",
                selected
                  ? "border-yellow-600 bg-yellow-400 text-yellow-950"
                  : isToday
                    ? "border-2 border-ink-strong text-ink-body"
                    : "border-line-strong text-ink-body hover:bg-surface-subtle",
                disabled ? "cursor-not-allowed opacity-40 hover:bg-transparent" : "",
              ].join(" ")}
            >
              <span className="text-[11px] font-semibold uppercase tracking-wide">
                {weekdays[weekdayIndex(date)].slice(0, 2)}
              </span>
              <span className="text-base font-semibold">{dayNumber}</span>
              {hasEntry && (
                <span className="mt-0.5 flex items-center gap-1 text-[10px] leading-none" aria-hidden="true">
                  <span className={selected ? "text-yellow-950" : "text-green-700"}>✓</span>
                  <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
