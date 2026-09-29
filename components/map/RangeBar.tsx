"use client";

import { useCallback, useRef } from "react";
import { mapStyle } from "@/lib/map/style";
import { fractionForTime, gapFractions, timeForFraction } from "@/lib/map/rangeBar";
import { useI18n } from "../LocaleProvider";

/**
 * The day page's own time bar — B2563 T3, a sibling of `TimeScrubber.tsx`
 * rather than a variant of it: that one selects a single stop from a
 * trip-wide list of dates; this one drags two handles across one day's own
 * span of instants, and has no stops or chips to draw at all.
 *
 * Two `role="slider"` handles, each independently focusable and keyboard-
 * operable (arrow keys move the focused handle by `stepMs`, Home/End snap it
 * to the bar's own start/end) — the same accessible contract `TimeScrubber`
 * already gives a single handle, doubled. `aria-valuetext` on each handle is
 * the caller's own formatted time (`formatHandle`), so it stays localised
 * the same way `TimeScrubber`'s does.
 *
 * Gaps (`ownerDayLine`'s `gapAfter`, resolved to fractions by
 * `lib/map/rangeBar.ts`'s `gapFractions`) are drawn dashed on the track
 * itself — D6's "no gap count", drawn instead.
 */
export default function RangeBar({
  start,
  end,
  fromT,
  toT,
  times,
  gapAfter,
  stepMs,
  onChange,
  formatHandle,
}: {
  /** The day's own first/last fix instant (epoch ms) — the bar's whole span. */
  start: number;
  end: number;
  /** The selection's own bounds, both within `[start, end]` and `fromT <= toT`. */
  fromT: number;
  toT: number;
  times: readonly number[];
  gapAfter: readonly boolean[];
  /** How far one arrow-key press moves a handle, in ms — the caller's own
   * idea of a sensible step (a minute, say), since this module has no
   * opinion on the day's own fix density. */
  stepMs: number;
  onChange: (next: { fromT: number; toT: number }) => void;
  formatHandle: (t: number) => string;
}) {
  const { t } = useI18n();
  const trackRef = useRef<HTMLDivElement | null>(null);

  const clamp = useCallback((t: number) => Math.min(end, Math.max(start, t)), [start, end]);

  const fromClientX = useCallback(
    (clientX: number): number => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return start;
      const fraction = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      return timeForFraction(fraction, start, end);
    },
    [start, end],
  );

  function dragHandle(which: "from" | "to") {
    return (event: React.PointerEvent<HTMLDivElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      const move = (clientX: number) => {
        const t = clamp(fromClientX(clientX));
        if (which === "from") onChange({ fromT: Math.min(t, toT), toT });
        else onChange({ fromT, toT: Math.max(t, fromT) });
      };
      move(event.clientX);
      const onMove = (e: PointerEvent) => move(e.clientX);
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    };
  }

  function onKeyDown(which: "from" | "to") {
    return (event: React.KeyboardEvent) => {
      const current = which === "from" ? fromT : toT;
      let next: number | null = null;
      switch (event.key) {
        case "ArrowRight":
        case "ArrowUp":
          next = clamp(current + stepMs);
          break;
        case "ArrowLeft":
        case "ArrowDown":
          next = clamp(current - stepMs);
          break;
        case "Home":
          next = start;
          break;
        case "End":
          next = end;
          break;
        default:
          return;
      }
      event.preventDefault();
      if (which === "from") onChange({ fromT: Math.min(next, toT), toT });
      else onChange({ fromT, toT: Math.max(next, fromT) });
    };
  }

  const fromPct = fractionForTime(fromT, start, end) * 100;
  const toPct = fractionForTime(toT, start, end) * 100;
  const gaps = gapFractions(times, gapAfter, start, end);

  return (
    <div className="mt-3">
      <div ref={trackRef} className="relative h-6 w-full touch-none">
        <div
          className="absolute left-0 top-1/2 h-1 w-full -translate-y-1/2 rounded-full"
          style={{ backgroundColor: mapStyle.border }}
          aria-hidden
        />
        {gaps.map(([from, to], i) => (
          <div
            key={i}
            className="absolute top-1/2 h-1 -translate-y-1/2 border-t-2 border-dashed"
            style={{ left: `${from * 100}%`, width: `${(to - from) * 100}%`, borderColor: mapStyle.border }}
            aria-hidden
          />
        ))}
        {/* The selected span itself, highlighted between the two handles. */}
        <div
          className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full"
          style={{ left: `${fromPct}%`, width: `${Math.max(0, toPct - fromPct)}%`, backgroundColor: mapStyle.selectedFill }}
          aria-hidden
        />
        <div
          role="slider"
          tabIndex={0}
          aria-label={t("map.rangeBar.fromHandle")}
          aria-valuemin={start}
          aria-valuemax={end}
          aria-valuenow={fromT}
          aria-valuetext={formatHandle(fromT)}
          onPointerDown={dragHandle("from")}
          onKeyDown={onKeyDown("from")}
          className="absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 cursor-pointer rounded-full border-2 shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          style={{ left: `${fromPct}%`, backgroundColor: mapStyle.selectedFill, borderColor: mapStyle.stopRing }}
        />
        <div
          role="slider"
          tabIndex={0}
          aria-label={t("map.rangeBar.toHandle")}
          aria-valuemin={start}
          aria-valuemax={end}
          aria-valuenow={toT}
          aria-valuetext={formatHandle(toT)}
          onPointerDown={dragHandle("to")}
          onKeyDown={onKeyDown("to")}
          className="absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 cursor-pointer rounded-full border-2 shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          style={{ left: `${toPct}%`, backgroundColor: mapStyle.selectedFill, borderColor: mapStyle.stopRing }}
        />
      </div>
    </div>
  );
}
