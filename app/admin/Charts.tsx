import { formatChf } from "@/lib/credits/pricing";

/**
 * The three pictures on `/admin` — B763.
 *
 * **Every chart here is one measure, so every chart is one hue.** Money, in
 * rappen, across four groups, or across journals, or across days. A
 * categorical palette would be answering a question nobody asked — the bars do
 * not have identities to tell apart, they have lengths to compare — and with a
 * single series there is no legend either, because the heading names it.
 *
 * The hue is `navy-700`, which is **8.63:1 on `cream-50`** and 8.98:1 on
 * white; both measured rather than judged. `yellow-400` is 1.39:1 on cream and
 * is not a data mark for the same reason `app/globals.css` says it is not a
 * text colour — the brand's yellow is for the mark and the waymark, not for
 * something a reader has to measure with their eye.
 *
 * **Drawn in CSS, not SVG.** A horizontal bar is a box whose width is a
 * percentage, which is a thing HTML already does at every screen width without
 * a viewBox, an `preserveAspectRatio`, or any of the four traps
 * `check-a-drawing` lists. It also means the labels are real text: they wrap,
 * they scale with the reader's font size, and they are selectable.
 *
 * **No JavaScript and no tooltips.** Every value is printed on or beside its
 * own mark, so a tooltip would repeat what is already on the screen. The daily
 * bars are the one place a value cannot fit, and they carry a `<title>` — the
 * hover a pointer expects, from the platform, costing nothing.
 */

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

export type Day = { date: string; rappen: number };

/**
 * Spend per day across the window — the "is it growing" question.
 *
 * Every day in the range is present, including the ones nothing happened on:
 * a chart that silently drops empty days compresses a quiet fortnight into
 * nothing and makes a single busy afternoon look like a trend. A zero day is a
 * fact and gets its column.
 *
 * `flex-1` on each bar rather than a computed width, so thirty columns fit a
 * 320px phone and a wide desktop from the same markup.
 */
export function DailyChart({ title, days, empty }: { title: string; days: Day[]; empty: string }) {
  const max = Math.max(...days.map((day) => day.rappen), 1);
  const total = days.reduce((sum, day) => sum + day.rappen, 0);

  return (
    <section className="mt-8">
      <h2 className="font-display text-lg font-semibold text-navy-900">{title}</h2>
      {total === 0 ? (
        <p className="mt-2 text-sm text-navy-500">{empty}</p>
      ) : (
        <>
          <div className="mt-3 flex h-24 items-end gap-px" role="img" aria-label={title}>
            {days.map((day) => (
              <div
                key={day.date}
                className="flex-1 rounded-t-sm bg-navy-700"
                // The attribute, not a <title> element: that one is SVG's, and
                // in HTML it would render as text inside the bar.
                title={`${day.date} — ${formatChf(day.rappen)}`}
                // A zero day still draws a 2px foot, so the axis reads as a
                // row of days rather than as a gap of unknown length.
                style={{ height: `${Math.max((day.rappen / max) * 100, 2)}%` }}
              />
            ))}
          </div>
          {/* Two labels rather than thirty: the ends are what a reader needs to
              know the span, and a tick per day is unreadable at any width. */}
          <div className="mt-1 flex justify-between font-mono text-xs text-navy-500">
            <span>{days[0]?.date}</span>
            <span>{days[days.length - 1]?.date}</span>
          </div>
          <p className="mt-1 text-xs text-navy-500">
            Busiest day {formatChf(max)}. Hover a column for its date.
          </p>
        </>
      )}
    </section>
  );
}
