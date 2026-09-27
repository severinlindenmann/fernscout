"use client";

import { useCallback, useMemo, useRef } from "react";
import { mapStyle } from "@/lib/map/style";
import { earliestTodayISO } from "@/lib/tripTime";
import { useI18n } from "../LocaleProvider";

export type ScrubberStop = {
  key: string;
  /** `YYYY-MM-DD` — the day this stop belongs to. */
  date: string;
  location: string;
};

const DAY_MS = 86_400_000;

/** UTC midnight for a plain `YYYY-MM-DD` — the same "no timezone" reading
 * every date in this app already gets (see `lib/tripTime.ts`). */
function dayNumber(date: string): number {
  return Date.parse(`${date}T00:00:00Z`) / DAY_MS;
}

/**
 * A horizontal track whose x-position is proportional to *dates*, not to
 * stop order — five months of `asia-2023` do not lay out like seven days of
 * `alps-2024` (docs/plans/map-redesign.md §1 "Time", Phase 2 item 3).
 *
 * The axis runs from the first stop's date to the last stop's date, or to
 * today when `live` — a trip under way has days ahead of the last one
 * written, and the handle should not sit at the far right while the trip is
 * still going. Controlled: the caller owns `selectedIndex` and gets an
 * `onSelect(index)` for every stop the track, drag or keyboard lands on;
 * nothing here reads or writes the map's own selection state.
 *
 * Accessible as a single `role="slider"` — the handle — rather than one
 * control per stop: `aria-valuetext` names the stop and its date (via the
 * caller's own date formatting, so it stays localised) on every change, the
 * same contract a native `<input type="range">` gives assistive tech.
 */
export default function TimeScrubber({
  stops,
  selectedIndex,
  onSelect,
  live = false,
  chips,
}: {
  stops: ScrubberStop[];
  /** Clamped internally — pass whatever the map currently has selected, or
   * `stops.length - 1` (the most recent stop) when nothing is. */
  selectedIndex: number;
  onSelect: (index: number) => void;
  /** Right edge is "today" instead of the last stop's date. */
  live?: boolean;
  /** Day chips under the track. By default only when the trip spans 7 days
   * or fewer (docs/plans/map-redesign.md §1 "Time"), counted from the dates
   * rather than the stops: a live 83-day trip with three stops is not a
   * short trip. */
  chips?: boolean;
}) {
  const { t, formatShortDate } = useI18n();
  const trackRef = useRef<HTMLDivElement | null>(null);
  const index = Math.min(Math.max(selectedIndex, 0), Math.max(0, stops.length - 1));

  const { positions, spanDays } = useMemo(() => {
    if (stops.length === 0) return { positions: [] as number[], spanDays: 0 };
    const days = stops.map((s) => dayNumber(s.date));
    const start = Math.min(...days);
    const rawEnd = Math.max(...days);
    const end = live ? Math.max(rawEnd, dayNumber(earliestTodayISO())) : rawEnd;
    const span = Math.max(1, end - start);
    return { positions: days.map((d) => (d - start) / span), spanDays: end - start + 1 };
  }, [stops, live]);
  const showChips = chips ?? spanDays <= 7;

  const nearestIndex = useCallback(
    (fraction: number) => {
      let best = 0;
      let bestDist = Infinity;
      positions.forEach((p, i) => {
        const dist = Math.abs(p - fraction);
        if (dist < bestDist) {
          bestDist = dist;
          best = i;
        }
      });
      return best;
    },
    [positions],
  );

  const selectFromClientX = useCallback(
    (clientX: number) => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return;
      const fraction = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      onSelect(nearestIndex(fraction));
    },
    [nearestIndex, onSelect],
  );

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    selectFromClientX(event.clientX);
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.buttons === 0) return;
    selectFromClientX(event.clientX);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (stops.length === 0) return;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowUp":
        onSelect(Math.min(stops.length - 1, index + 1));
        event.preventDefault();
        break;
      case "ArrowLeft":
      case "ArrowDown":
        onSelect(Math.max(0, index - 1));
        event.preventDefault();
        break;
      case "Home":
        onSelect(0);
        event.preventDefault();
        break;
      case "End":
        onSelect(stops.length - 1);
        event.preventDefault();
        break;
      default:
        break;
    }
  };

  if (stops.length === 0) return null;
  const selected = stops[index];
  const handlePct = (positions[index] ?? 0) * 100;

  return (
    <div className="mt-3">
      <div
        ref={trackRef}
        className="relative h-6 w-full cursor-pointer touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
      >
        {/* The line itself, decorative — the slider role and its value live
            on the handle below. */}
        <div
          className="absolute left-0 top-1/2 h-1 w-full -translate-y-1/2 rounded-full"
          style={{ backgroundColor: mapStyle.border }}
          aria-hidden
        />
        {/* One tick per stop, at its actual date — not evenly spaced. */}
        {stops.map((stop, i) => (
          <div
            key={stop.key}
            className="absolute top-1/2 h-2.5 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{ left: `${positions[i] * 100}%`, backgroundColor: mapStyle.border }}
            aria-hidden
          />
        ))}
        <div
          role="slider"
          tabIndex={0}
          aria-label={t("map.timeline")}
          aria-valuemin={0}
          aria-valuemax={Math.max(0, stops.length - 1)}
          aria-valuenow={index}
          aria-valuetext={t("map.timelineValue", {
            location: selected.location,
            date: formatShortDate(selected.date),
          })}
          onKeyDown={onKeyDown}
          className="absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          style={{
            left: `${handlePct}%`,
            backgroundColor: mapStyle.selectedFill,
            borderColor: mapStyle.stopRing,
          }}
        />
      </div>

      {showChips && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {stops.map((stop, i) => (
            <button
              key={stop.key}
              type="button"
              onClick={() => onSelect(i)}
              aria-pressed={i === index}
              aria-label={`${stop.location}, ${formatShortDate(stop.date)}`}
              className={`min-h-8 rounded-full border px-2.5 text-xs font-semibold transition-colors ${
                i === index
                  ? "border-transparent bg-action-strong text-on-action"
                  : "border-line-quiet bg-surface-raised text-ink-body hover:border-line-prominent"
              }`}
            >
              {formatShortDate(stop.date)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
