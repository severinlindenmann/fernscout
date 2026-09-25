"use client";

import { useMemo } from "react";
import { SERIES } from "./Charts";
import { formatChf } from "@/lib/creditsFormat";
import { OPERATION_LABEL } from "@/lib/operations";
import type { DailySpend } from "@/lib/instanceCosts";

/**
 * Spend per day, split by what spent it — B996 (decision 3A).
 *
 * B763's chart was one hue and one question: is it growing. It could not say
 * *what* grew, which is the next thing anybody asks and the only one that
 * leads to an action. Every usage row has carried the operation since B746;
 * this is that column, finally drawn.
 *
 * **The period is the page's.** The 7 · 30 · 90 switch moved to the page's
 * own header, where it sets every figure at once; the chart still receives
 * the whole ninety days and draws the last `span` of them, so the colours
 * below stay ranked over the same series whichever period is showing.
 *
 * **The alert line** is the operator's own `costs.alertDailyRappen`, drawn
 * dashed across the bars when it is set. A day above it is one the nightly
 * check mails about (`lib/spendAlert.ts`). When the line is above every bar,
 * the scale stretches to show it rather than leaving it off the chart — a
 * line you cannot see is a line you forget you set.
 *
 * **The colours are assigned over the ninety days, not over the visible range.**
 * Ranking within the visible period would repaint every bar when you press 7,
 * which reads as the data changing rather than the range. An operation outside
 * the top five is folded into one grey "everything else" rather than given a
 * sixth hue nobody can tell from the fifth.
 *
 * The fixed monthly lines are not in here and must not be: they are owed
 * whether anybody writes a day or not, and on this instance they are nine
 * tenths of the bill — drawn per day they would flatten every real movement
 * into a rounding error. The page states the floor beside the chart instead.
 */

/** Beyond this many, the rest is one band. Five is what the ramp holds before
 *  two hues start looking alike at the width of a phone column. */
const NAMED = 5;

export default function SpendChart({
  days,
  span = 30,
  alertRappen = 0,
}: {
  days: DailySpend[];
  /** How many of the most recent days to draw. */
  span?: number;
  /** The operator's alert line per day, or 0 for none. */
  alertRappen?: number;
}) {
  /** Which operations get their own hue, ranked over everything we hold. */
  const ranked = useMemo(() => {
    const total = new Map<string, number>();
    for (const day of days) {
      for (const part of day.parts) {
        total.set(part.operation, (total.get(part.operation) ?? 0) + part.rappen);
      }
    }
    return [...total]
      .sort((a, b) => b[1] - a[1])
      .slice(0, NAMED)
      .map(([operation]) => operation);
  }, [days]);

  const shown = days.slice(Math.max(days.length - span, 0));
  const peak = Math.max(...shown.map((day) => day.rappen), 1);
  const max = alertRappen > 0 ? Math.max(peak, Math.round(alertRappen * 1.1)) : peak;
  const total = shown.reduce((sum, day) => sum + day.rappen, 0);
  const rest = ranked.length < new Set(days.flatMap((d) => d.parts.map((p) => p.operation))).size;

  return (
    <section>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-lg font-semibold text-ink-strong">Metered spend, by day</h2>
        <span className="font-mono text-sm text-ink-body">
          {total === 0 ? "" : `peak ${formatChf(peak)}`}
        </span>
      </div>

      {total === 0 ? (
        <p className="mt-2 text-sm text-ink-muted">
          Nothing metered in these {span} days. Models and speech are the only things counted
          here — the fixed monthly lines are below.
        </p>
      ) : (
        <>
          <div className="relative mt-3 flex h-40 items-end gap-px" role="img" aria-label="Spend per day">
            {alertRappen > 0 ? (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-dashed border-coral-600"
                style={{ bottom: `${(alertRappen / max) * 100}%` }}
              >
                <span className="absolute -top-5 right-0 bg-surface-raised px-1 font-mono text-[11px] text-coral-600">
                  alert {formatChf(alertRappen)}/day
                </span>
              </div>
            ) : null}
            {shown.map((day) => (
              <div
                key={day.date}
                className="flex h-full flex-1 flex-col justify-end"
                title={`${day.date} — ${formatChf(day.rappen)}`}
              >
                {/* One segment per operation, largest at the bottom. A day
                    with nothing still draws a 2px foot, so the axis reads as
                    a row of days rather than as a gap of unknown length. */}
                {day.rappen === 0 ? (
                  <div className="h-0.5 rounded-sm bg-surface-muted" />
                ) : (
                  <div
                    className="flex flex-col-reverse overflow-hidden rounded-t-sm"
                    style={{ height: `${Math.max((day.rappen / max) * 100, 3)}%` }}
                  >
                    {day.parts.map((part) => (
                      <div
                        key={part.operation}
                        className={hueOf(part.operation, ranked)}
                        style={{ height: `${(part.rappen / day.rappen) * 100}%` }}
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="mt-1 flex justify-between font-mono text-xs text-ink-muted">
            <span>{shown[0]?.date}</span>
            <span>{shown[shown.length - 1]?.date}</span>
          </div>

          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
            {ranked.map((operation, at) => (
              <li key={operation} className="flex items-center gap-1.5 text-xs text-ink-body">
                <span className={`inline-block h-2 w-2 rounded-full ${SERIES[at]}`} />
                {OPERATION_LABEL[operation] ?? operation}
              </li>
            ))}
            {rest ? (
              <li className="flex items-center gap-1.5 text-xs text-ink-body">
                <span className="inline-block h-2 w-2 rounded-full bg-surface-selected" />
                everything else
              </li>
            ) : null}
          </ul>

          <p className="mt-2 text-sm text-ink-body">
            <span className="font-mono text-ink-strong">{formatChf(total)}</span> over {span} days.
          </p>
        </>
      )}
    </section>
  );
}

/** The band's colour, from its rank over the whole series. Anything unranked
 *  is the grey that the legend calls "everything else". */
function hueOf(operation: string, ranked: string[]): string {
  const at = ranked.indexOf(operation);
  return at === -1 ? "bg-surface-selected" : SERIES[at];
}
