import { formatChf } from "@/lib/credits/pricing";
import type { CostLine } from "@/lib/instanceCosts";

/**
 * The pictures on `/admin` — B763, widened by B996.
 *
 * **One measure, one hue, wherever there is one measure.** Money across four
 * groups, or across journals, is `navy-700` and nothing else: those bars have
 * no identities to tell apart, only lengths to compare, and a categorical
 * palette would be answering a question nobody asked.
 *
 * B996 added the one chart where the categories *are* the question — spend
 * split by which feature spent it — and that one gets a ramp, in `SERIES`
 * below. `yellow-400` is not in it: it is 1.39:1 on cream, it is the brand's
 * waymark rather than a measure, and `app/globals.css` already says it is not
 * a text colour for the same reason.
 *
 * **Drawn in CSS wherever a bar will do.** A horizontal bar is a box whose
 * width is a percentage, which HTML does at every screen width without a
 * viewBox or a `preserveAspectRatio`. The labels stay real text: they wrap,
 * they scale with the reader's font size, and they are selectable. Only the
 * sparkline is SVG, because a polyline is not a box.
 */

/** The hues a stacked series may use, in order. Every one is a measured
 *  contrast on cream and on white; see the note above on the yellow. */
export const SERIES = [
  "bg-navy-700",
  "bg-sky-500",
  "bg-green-700",
  "bg-coral-400",
  "bg-navy-500",
  "bg-sky-300",
] as const;

/** A row of the horizontal bar charts: what it is, and how much. */
export type Bar = { label: string; rappen: number; note?: string };

/**
 * Horizontal bars, longest first.
 *
 * Horizontal rather than vertical because the labels are phrases — "Models and
 * speech", a journal's name — and vertical bars would either rotate them or
 * truncate them. Sorted by length so the eye lands on the largest without
 * having to scan, which is the whole job of this chart.
 */
export function BarChart({ title, bars, empty }: { title: string; bars: Bar[]; empty: string }) {
  const rows = [...bars].sort((a, b) => b.rappen - a.rappen);
  const max = Math.max(...rows.map((row) => row.rappen), 1);
  const shown = rows.filter((row) => row.rappen > 0);

  return (
    <section className="mt-8">
      <h2 className="font-display text-lg font-semibold text-navy-900">{title}</h2>
      {shown.length === 0 ? (
        <p className="mt-2 text-sm text-navy-500">{empty}</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {shown.map((row) => (
            <li key={row.label}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 break-words text-sm text-navy-700">{row.label}</span>
                <span className="shrink-0 font-mono text-sm text-navy-900">
                  {formatChf(row.rappen)}
                </span>
              </div>
              {/* The mark. `max` is the longest bar rather than the total, so a
                  chart of one dominant line still shows the small ones as
                  something rather than as a hairline. */}
              <div className="mt-1 h-2 w-full rounded-full bg-cream-200">
                <div
                  className="h-2 rounded-full bg-navy-700"
                  style={{ width: `${Math.max((row.rappen / max) * 100, 2)}%` }}
                />
              </div>
              {row.note ? <p className="mt-1 text-xs text-navy-500">{row.note}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * A proportion, drawn once — B996.
 *
 * The one shape this page repeats: credits left of credits granted, bytes used
 * of bytes allowed, one feature's spend against the largest. Written once so
 * that the eight places it appears cannot drift into eight slightly different
 * bars.
 */
export function Meter({
  fraction,
  tone = "navy",
}: {
  fraction: number;
  tone?: "navy" | "alert" | "good";
}) {
  const width = Math.min(Math.max(fraction, 0), 1) * 100;
  const fill =
    tone === "alert" ? "bg-coral-600" : tone === "good" ? "bg-green-700" : "bg-navy-700";
  return (
    <div className="mt-1 h-1.5 w-full rounded-full bg-cream-200">
      {/* A measured zero draws nothing at all. Every other bar keeps a 2%
          foot so a small number reads as small rather than as absent. */}
      <div
        className={`h-1.5 rounded-full ${fill}`}
        style={{ width: width === 0 ? "0" : `${Math.max(width, 2)}%` }}
      />
    </div>
  );
}

/**
 * One journal's thirty days, as a line the width of a thumb — B996.
 *
 * SVG rather than CSS: this is the one mark on the page that is a shape and
 * not a box. `preserveAspectRatio="none"` on purpose — the line is read for
 * where it rises, never for the angle it rises at, and letting it stretch to
 * whatever width the row gives is what keeps it from needing a media query.
 *
 * A flat series draws a flat line rather than nothing: "this journal spent the
 * same small amount every day" and "this journal is absent" are different
 * facts, and the caller decides which by not rendering one at all.
 */
export function Sparkline({ points, label }: { points: number[]; label: string }) {
  if (points.length < 2) return null;
  const max = Math.max(...points, 1);
  const line = points
    .map((value, at) => {
      const x = (at / (points.length - 1)) * 100;
      const y = 20 - (value / max) * 18;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  return (
    <svg
      viewBox="0 0 100 20"
      preserveAspectRatio="none"
      className="h-5 w-20 shrink-0 text-navy-500"
      role="img"
      aria-label={label}
    >
      <polyline
        points={line}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export type Week = { week: string; count: number };

/**
 * A count per week — B996.
 *
 * Deliberately separate from the money charts rather than a `rappen`-shaped
 * fake. Everything else here formats francs, and a count pushed through
 * `formatChf` reads "CHF 63.00 days written" to anybody who is skimming.
 */
export function CountBars({
  title,
  weeks,
  unit,
  empty,
}: {
  title: string;
  weeks: Week[];
  unit: string;
  empty: string;
}) {
  const max = Math.max(...weeks.map((week) => week.count), 1);
  const total = weeks.reduce((sum, week) => sum + week.count, 0);

  return (
    <div className="mt-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-navy-600">{title}</span>
        <span className="font-mono text-sm text-navy-900">
          {total} {unit}
        </span>
      </div>
      {total === 0 ? (
        <p className="mt-1 text-sm text-navy-500">{empty}</p>
      ) : (
        <>
          <div className="mt-2 flex h-14 items-end gap-0.5">
            {weeks.map((week) => (
              <div
                key={week.week}
                className="flex-1 rounded-t-sm bg-navy-700"
                title={`week of ${week.week} — ${week.count} ${unit}`}
                style={{ height: `${Math.max((week.count / max) * 100, 2)}%` }}
              />
            ))}
          </div>
          <div className="mt-1 flex justify-between font-mono text-xs text-navy-500">
            <span>{weeks[0]?.week}</span>
            <span>this week</span>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Where the money went, one group at a time — B996 (decision 4A).
 *
 * The four lists B746 printed in full were most of the page's length and are
 * read about once a quarter; the four bars above them answered the question
 * everybody actually had. This is both: the bar is the answer, and the lines
 * are one tap underneath it.
 *
 * `<details>` rather than client state — the browser has had this control for
 * a decade, it works before any JavaScript loads, and the open one stays open
 * across a soft navigation without anything being remembered anywhere.
 */
export function Breakdown({
  groups,
}: {
  groups: { label: string; lines: CostLine[]; note: string }[];
}) {
  const totals = groups.map((group) => ({
    ...group,
    rappen: group.lines.reduce((sum, line) => sum + line.rappen, 0),
    unpriced: group.lines.some((line) => line.unpriced),
  }));
  const max = Math.max(...totals.map((group) => group.rappen), 1);

  return (
    <ul className="mt-3 space-y-2">
      {totals
        .sort((a, b) => b.rappen - a.rappen)
        .map((group) => (
          <li key={group.label}>
            <details className="group">
              <summary className="cursor-pointer list-none">
                <span className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 break-words text-sm text-navy-700">
                    {group.label}
                    <span className="ml-1 text-navy-500 group-open:hidden">
                      · {group.lines.length}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-sm text-navy-900">
                    {group.rappen === 0 && group.unpriced ? (
                      <span className="text-navy-500">not priced</span>
                    ) : (
                      formatChf(group.rappen)
                    )}
                  </span>
                </span>
                {/* A group that cost nothing draws nothing — the same rule
                    `Meter` keeps, and for the same reason: a 2% foot under
                    "CHF 0.00" reads as a small amount rather than as none. */}
                <span className="mt-1 block h-2 w-full rounded-full bg-cream-200">
                  <span
                    className="block h-2 rounded-full bg-navy-700"
                    style={{
                      width:
                        group.rappen === 0 ? "0" : `${Math.max((group.rappen / max) * 100, 2)}%`,
                    }}
                  />
                </span>
              </summary>
              <div className="mt-2 border-l-2 border-navy-200 pl-3">
                <p className="text-xs text-navy-500">{group.note}</p>
                {group.lines.length === 0 ? (
                  <p className="mt-1 text-sm text-navy-500">Nothing in this period.</p>
                ) : (
                  <ul className="mt-1 divide-y divide-navy-200">
                    {group.lines.map((line) => (
                      <li key={`${line.label}-${line.detail}`} className="py-1.5">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="min-w-0 break-words text-sm text-navy-900">
                            {line.label}
                          </span>
                          <span className="shrink-0 font-mono text-sm text-navy-900">
                            {line.unpriced ? (
                              <span className="text-navy-500">not priced</span>
                            ) : (
                              formatChf(line.rappen)
                            )}
                          </span>
                        </div>
                        <p className="mt-0.5 [overflow-wrap:anywhere] font-mono text-xs text-navy-500">
                          {line.detail}
                          {line.calls > 0
                            ? ` · ${line.calls} ${line.calls === 1 ? "call" : "calls"}`
                            : ""}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </details>
          </li>
        ))}
    </ul>
  );
}
