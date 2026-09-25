"use client";

import { useId, useState } from "react";
import { useI18n } from "@/components/LocaleProvider";
import MonthGrid from "@/components/studio/day/MonthGrid";
import type { EditablePickerTrip } from "@/lib/studio/editDay";
import { dayOfTrip, localToday, numericDate, parseTypedDate } from "@/lib/studio/monthGrid";

/** What a caller knows about the trip around the date — all optional. */
export type TripCalendar = {
  tripStart?: string;
  tripEnd?: string;
  writtenDates?: string[];
  draftDates?: string[];
};

/** A trip's span and its told and draft days, from the day picker the studio
 *  page already read — no fetch of its own. */
export function tripCalendar(
  picker: EditablePickerTrip[],
  trip?: { id: string; start?: string; end?: string },
): TripCalendar {
  if (!trip) return {};
  const days = picker.find((p) => p.tripId === trip.id)?.days ?? [];
  return {
    tripStart: trip.start,
    tripEnd: trip.end,
    writtenDates: days.filter((d) => d.entries.some((e) => e.status === "published")).map((d) => d.date),
    draftDates: days.filter((d) => d.entries.every((e) => e.status === "draft")).map((d) => d.date),
  };
}

type Range = {
  start: string;
  end: string;
  onChange: (start: string, end: string) => void;
  startLabel: string;
  endLabel: string;
  /** Shown under the last-day field, e.g. "the last day is before the first". */
  endError?: string;
};

type Props = TripCalendar & { labelClassName?: string } & (
  | { label: string; value: string; onChange: (date: string) => void; range?: undefined }
  | { range: Range; label?: undefined; value?: undefined; onChange?: undefined }
);

const LABEL = "block text-xs font-semibold uppercase tracking-wide text-ink-secondary";

/**
 * B2167 — Fernscout's own date field: a typed field (the date in words, the
 * locale's numeric form while typing) with the month grid inline under it.
 * With `range`, two fields and one grid: the first tap is the first day, the
 * second the last, a tap before the first day starts again.
 */
export default function DateField(props: Props) {
  const { t } = useI18n();
  const { range, tripStart, tripEnd, writtenDates, draftDates } = props;
  const [awaitingEnd, setAwaitingEnd] = useState(false);
  const labelClassName = props.labelClassName ?? LABEL;

  const pick = (date: string) => {
    if (!range) return props.onChange(date);
    if (!awaitingEnd || !range.start || date < range.start) {
      range.onChange(date, date);
      setAwaitingEnd(true);
    } else {
      range.onChange(range.start, date);
      setAwaitingEnd(false);
    }
  };

  const band = range
    ? range.start && range.end && range.start <= range.end ? { start: range.start, end: range.end } : undefined
    : tripStart && tripEnd ? { start: tripStart, end: tripEnd } : undefined;
  const chip = !range && props.value && tripStart && tripEnd && props.value >= tripStart && props.value <= tripEnd
    ? t("studio.date.dayOfTrip", { n: String(dayOfTrip(props.value, tripStart)) })
    : undefined;

  return (
    <div data-date-field className="mt-3">
      {range ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <TypedDate label={range.startLabel} labelClassName={labelClassName} value={range.start}
            onCommit={(start) => { range.onChange(start, range.end); setAwaitingEnd(false); }} />
          <TypedDate label={range.endLabel} labelClassName={labelClassName} value={range.end} error={range.endError}
            onCommit={(end) => { range.onChange(range.start, end); setAwaitingEnd(false); }} />
        </div>
      ) : (
        <TypedDate label={props.label} labelClassName={labelClassName} value={props.value} chip={chip} onCommit={props.onChange} />
      )}
      <MonthGrid
        value={range ? range.end || range.start : props.value}
        selected={range ? [range.start, range.end].filter(Boolean) : undefined}
        onChange={pick}
        band={band}
        writtenDates={writtenDates}
        draftDates={draftDates}
      >
        <div className="mt-2 flex justify-end">
          <button type="button" onClick={() => pick(localToday())}
            className="min-h-11 rounded-full border border-line-strong px-4 text-sm font-semibold text-ink-strong hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500">
            {t("studio.date.today")}
          </button>
        </div>
      </MonthGrid>
    </div>
  );
}

function TypedDate({ label, labelClassName, value, onCommit, chip, error }: {
  label: string;
  labelClassName: string;
  value: string;
  onCommit: (date: string) => void;
  chip?: string;
  error?: string;
}) {
  const { t, locale, formatLongDate } = useI18n();
  const id = useId();
  /** The text while typing; null shows the committed date in words. */
  const [draft, setDraft] = useState<string | null>(null);
  const [unreadable, setUnreadable] = useState(false);
  const pattern = t("studio.date.pattern");
  const message = unreadable ? t("studio.date.invalid", { pattern }) : error;

  return (
    <div>
      <label htmlFor={id} className={labelClassName}>{label}</label>
      <div className="relative mt-1">
        <input
          id={id}
          type="text"
          autoComplete="off"
          value={draft ?? (value ? formatLongDate(value, { year: true }) : "")}
          placeholder={pattern}
          aria-invalid={message ? true : undefined}
          aria-describedby={message ? `${id}-error` : undefined}
          onFocus={(event) => {
            setDraft(value ? numericDate(value, locale) : "");
            event.currentTarget.select();
          }}
          onChange={(event) => {
            const text = event.target.value;
            setDraft(text);
            setUnreadable(false);
            const iso = text.trim() ? parseTypedDate(text) : "";
            if (iso !== null) onCommit(iso);
          }}
          onBlur={() => {
            if (draft?.trim() && !parseTypedDate(draft)) setUnreadable(true);
            setDraft(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
          className={`block min-h-11 w-full rounded-xl border bg-surface-raised px-3 text-base text-ink-strong ${chip ? "pr-24" : ""} ${message ? "border-coral-600" : "border-line-strong"}`}
        />
        {chip && draft === null && (
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded-full border border-line-quiet bg-surface-subtle px-2 py-0.5 font-mono text-xs text-ink-secondary">
            {chip}
          </span>
        )}
      </div>
      {message && (
        <p id={`${id}-error`} role="alert" className="mt-1.5 text-sm text-coral-600">{message}</p>
      )}
    </div>
  );
}
