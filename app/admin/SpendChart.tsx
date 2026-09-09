"use client";

import { useMemo, useState } from "react";
import { SERIES } from "./Charts";
import { formatChf } from "@/lib/credits/pricing";
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
 * **The whole ninety days are sent once and the switch is client-side.** The
 * alternative is a round trip per press, and the data is a few hundred numbers
 * — smaller than the markup around it. It also means the switch cannot be a
 * moment where the page goes blank.
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

const WINDOWS = [7, 30, 90] as const;

/** Beyond this many, the rest is one band. Five is what the ramp holds before
 *  two hues start looking alike at the width of a phone column. */
const NAMED = 5;

export default function SpendChart({ days }: { days: DailySpend[] }) {
  const [span, setSpan] = useState<number>(30);

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
  const max = Math.max(...shown.map((day) => day.rappen), 1);
  const total = shown.reduce((sum, day) => sum + day.rappen, 0);
  const rest = ranked.length < new Set(days.flatMap((d) => d.parts.map((p) => p.operation))).size;

  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-lg font-semibold text-navy-900">Metered spend, by day</h2>
        <div role="group" aria-label="How many days" className="flex gap-1">
          {WINDOWS.map((count) => (
            <button
              key={count}
              type="button"
              aria-pressed={span === count}
              onClick={() => setSpan(count)}
              className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${
                span === count
                  ? "border-navy-900 bg-navy-900 text-white"
                  : "border-navy-200 bg-white text-navy-700 hover:bg-cream-100"
              }`}
            >
              {count}d
            </button>
          ))}
        </div>
      </div>

      {total === 0 ? (
        <p className="mt-2 text-sm text-navy-500">
          Nothing metered in these {span} days. Models and speech are the only things counted
          here — the fixed monthly lines are below.
        </p>
      ) : (
        <>
          <div className="mt-3 flex h-28 items-end gap-px" role="img" aria-label="Spend per day">
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
                  <div className="h-0.5 rounded-sm bg-cream-200" />
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
          <div className="mt-1 flex justify-between font-mono text-xs text-navy-500">
            <span>{shown[0]?.date}</span>
            <span>{shown[shown.length - 1]?.date}</span>
          </div>

          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
            {ranked.map((operation, at) => (
              <li key={operation} className="flex items-center gap-1.5 text-xs text-navy-700">
                <span className={`inline-block h-2 w-2 rounded-full ${SERIES[at]}`} />
                {OPERATION_LABEL[operation] ?? operation}
              </li>
            ))}
            {rest ? (
              <li className="flex items-center gap-1.5 text-xs text-navy-700">
                <span className="inline-block h-2 w-2 rounded-full bg-navy-200" />
                everything else
              </li>
            ) : null}
          </ul>

          <p className="mt-2 text-sm text-navy-700">
            <span className="font-mono text-navy-900">{formatChf(total)}</span> over {span} days.
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
  return at === -1 ? "bg-navy-200" : SERIES[at];
}
