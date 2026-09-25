"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useI18n } from "@/components/LocaleProvider";
import { monthNames, weekdayNames } from "@/lib/i18n";
import { isOutOfRange } from "@/lib/studio/dayStrip";
import { canShiftMonth, clampDate, keyboardDate, localToday, monthWindow, shiftMonth } from "@/lib/studio/monthGrid";

/**
 * The one month grid (B1997, grown by B2167). The "which day" step shows it
 * behind DayStrip; `DateField` puts it under a typed field everywhere else.
 * A trip shows as a soft band, told days as a green dot, drafts as a yellow
 * one, today as a dashed ring, the chosen day(s) filled navy. `min`/`max`
 * are hard bounds (days outside are disabled); days outside `band` stay
 * choosable, only quieter.
 */
export default function MonthGrid({
  value,
  onChange,
  min = "",
  max = "9999-12-31",
  band,
  writtenDates = [],
  draftDates = [],
  selected = [value],
  children,
}: {
  /** The chosen day; the month shown follows it. Empty shows today's month. */
  value: string;
  onChange: (date: string) => void;
  min?: string;
  max?: string;
  band?: { start: string; end: string };
  writtenDates?: string[] | Set<string>;
  draftDates?: string[] | Set<string>;
  /** Days drawn as chosen — both ends of a range. Defaults to `value`. */
  selected?: string[];
  /** A footer inside the card (DateField's "Today"). */
  children?: React.ReactNode;
}) {
  const { t, locale, formatLongDate } = useI18n();
  const labelId = useId();
  const [today] = useState(localToday);
  const anchor = () => clampDate(value || today, min, max);
  const [focusDate, setFocusDate] = useState(anchor);
  const [trackedValue, setTrackedValue] = useState(value);
  const focusButton = useRef<HTMLButtonElement>(null);
  const focusRequested = useRef(false);
  if (value !== trackedValue) {
    setTrackedValue(value);
    setFocusDate(anchor());
  } else if (focusDate !== clampDate(focusDate, min, max)) {
    setFocusDate(clampDate(focusDate, min, max));
  }
  useEffect(() => {
    if (focusRequested.current) {
      focusButton.current?.focus();
      focusRequested.current = false;
    }
  }, [focusDate]);

  const written = writtenDates instanceof Set ? writtenDates : new Set(writtenDates);
  const drafts = draftDates instanceof Set ? draftDates : new Set(draftDates);
  const weekdays = weekdayNames(locale);
  const days = monthWindow(focusDate);
  const navigationClass = "flex h-11 w-11 items-center justify-center rounded-full border border-line-strong text-ink-body hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500";

  return (
    <div className="mt-2 max-w-sm rounded-2xl border border-line-quiet bg-surface-raised p-3" role="group" aria-labelledby={labelId}>
      <div className="flex items-center justify-between gap-2">
        <button type="button" className={navigationClass}
          aria-label={t("studio.day.month.prevMonth")}
          disabled={!canShiftMonth(focusDate, -1, min, max)}
          onClick={() => setFocusDate(clampDate(shiftMonth(focusDate, -1), min, max))}>
          <span aria-hidden="true">‹</span>
        </button>
        <span id={labelId} aria-live="polite" aria-atomic="true" className="font-display text-lg font-semibold text-ink-strong">
          {monthNames(locale)[Number(focusDate.slice(5, 7)) - 1]} {focusDate.slice(0, 4)}
        </span>
        <button type="button" className={navigationClass}
          aria-label={t("studio.day.month.nextMonth")}
          disabled={!canShiftMonth(focusDate, 1, min, max)}
          onClick={() => setFocusDate(clampDate(shiftMonth(focusDate, 1), min, max))}>
          <span aria-hidden="true">›</span>
        </button>
      </div>
      <div className="mt-2 grid grid-cols-7 gap-y-1">
        {[1, 2, 3, 4, 5, 6, 0].map((day) => (
          <span key={day} aria-hidden="true" className="py-1 text-center font-mono text-[11px] font-semibold uppercase tracking-wide text-ink-secondary">
            {weekdays[day].slice(0, 2)}
          </span>
        ))}
        {days.map((date, index) => {
          if (!date) return <span key={`padding-${index}`} aria-hidden="true" />;
          const chosen = selected.includes(date);
          const isToday = date === today;
          const disabled = isOutOfRange(date, min, max);
          const inBand = !!band && date >= band.start && date <= band.end;
          const dot = drafts.has(date) ? "draft" : written.has(date) ? "written" : null;
          const column = index % 7;
          return (
            <div key={date} className="relative flex justify-center">
              {inBand && (
                <span aria-hidden="true" data-band className={[
                  "absolute inset-0 bg-surface-neutral-strong",
                  date === band.start || column === 0 ? "rounded-l-xl" : "",
                  date === band.end || column === 6 ? "rounded-r-xl" : "",
                ].join(" ")} />
              )}
              <button type="button" disabled={disabled} data-date={date}
                ref={date === focusDate ? focusButton : undefined}
                tabIndex={date === focusDate && !disabled ? 0 : -1}
                aria-pressed={chosen} aria-current={isToday ? "date" : undefined}
                aria-label={dot ? t("studio.day.strip.dayWithEntry", { date: formatLongDate(date) }) : formatLongDate(date)}
                onFocus={() => setFocusDate(date)}
                onClick={() => onChange(date)}
                onKeyDown={(event) => {
                  const next = keyboardDate(date, event.key, min, max);
                  if (next === null) return;
                  event.preventDefault();
                  if (next !== focusDate) {
                    focusRequested.current = true;
                    setFocusDate(next);
                  }
                }}
                className={[
                  "relative flex h-11 w-11 items-center justify-center rounded-full font-display text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500",
                  chosen ? "bg-action-strong font-semibold text-on-action"
                    : band && !inBand ? "font-medium text-ink-secondary hover:bg-surface-subtle"
                      : "font-semibold text-ink-strong hover:bg-surface-selected",
                  isToday ? "border-2 border-dashed border-line-prominent" : "",
                  disabled ? "cursor-not-allowed opacity-40 hover:bg-transparent" : "",
                ].join(" ")}>
                {Number(date.slice(8, 10))}
                {dot && (
                  <span aria-hidden="true" data-dot={dot} className={`absolute bottom-1 h-1.5 w-1.5 rounded-full ${dot === "draft" ? "bg-yellow-400 ring-1 ring-yellow-600" : "bg-green-500"}`} />
                )}
              </button>
            </div>
          );
        })}
      </div>
      {children}
    </div>
  );
}
