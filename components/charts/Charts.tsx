"use client";

import { useId, useState } from "react";
import { motion, useReducedMotion } from "motion/react";

/**
 * Small SVG chart primitives, built to the project's data-viz rules:
 * thin marks, 4px rounded data-ends, a 2px surface gap between stacked
 * segments, recessive axes, direct labels rather than a number on every
 * mark, and a hover tooltip on every plotted form.
 */

const INK = "#1e293b";
const MUTED = "#64748b";
const GRID = "#e6e2d6";
const SURFACE = "#fffaf0";

export type Slice = { key: string; label: string; value: number; color: string };

function useTooltip() {
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  return { tip, setTip };
}

function Tooltip({ tip, width }: { tip: { x: number; y: number; text: string }; width: number }) {
  // Keep the bubble inside the plot instead of clipping at the edges.
  const left = Math.min(Math.max(tip.x, 8), width - 8);
  return (
    <div
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg border border-navy-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-navy-900 shadow-md"
      style={{ left, top: tip.y - 8 }}
    >
      {tip.text}
    </div>
  );
}

/** Part-to-whole: one horizontal stacked bar plus a labelled legend. */
/**
 * The props that make something grow into place when it is scrolled to.
 *
 * `whileInView` is a *trigger*, not just an animation: until the observer
 * fires, the element sits at `initial` forever. So for a reader who has asked
 * their system for less movement, dropping the duration is not enough — the
 * gate has to go too, or they get a permanently empty chart instead of a still
 * one.
 *
 * `animate`, not only `initial: false`. `useReducedMotion` cannot know the
 * answer while the HTML is being made, so the first client render — the one
 * that has to match it — is the unreduced branch, and `initial` has already
 * been applied by the time the hook reports back. `animate` is read on every
 * render, so the second one puts the bar where it belongs; `MotionConfig
 * reducedMotion="user"` in the root provider is what makes it arrive there
 * without travelling.
 */
function useGrow() {
  const still = useReducedMotion();
  return (from: Record<string, number>, to: Record<string, number>, transition: object) =>
    still
      ? ({ initial: false, animate: to } as const)
      : ({ initial: from, whileInView: to, viewport: { once: true }, transition } as const);
}

/**
 * Why every bar here is drawn at its real size and *then* animated.
 *
 * These charts used to animate the size itself — `initial={{ width: 0 }}`,
 * `whileInView={{ width: "62%" }}` — which puts `width: 0` in the markup and
 * leaves it there until an IntersectionObserver fires. Anything that never
 * fires one gets an empty chart and no hint that it is a chart: a reader with
 * JavaScript off, a screenshot taken before the page is scrolled that far,
 * printing, a crawler. "Every bar renders at zero height" was reported as a
 * layout bug, and from outside that is exactly what it looks like.
 *
 * A transform has neither problem. The bar is its true size from the first
 * paint and `scaleX`/`scaleY` grows it into place; when nothing runs, the
 * chart is simply correct and still. It is also the cheaper animation, and the
 * one Motion already knows to drop for a reader who asked for less of it.
 */
export function StackedShareBar({
  slices,
  format,
  height = 30,
}: {
  slices: Slice[];
  format: (n: number) => string;
  height?: number;
}) {
  const grow = useGrow();
  const { tip, setTip } = useTooltip();
  const total = slices.reduce((n, s) => n + s.value, 0) || 1;
  const GAP = 2;

  return (
    <div className="relative">
      <div className="flex w-full overflow-hidden rounded-lg" style={{ height, gap: GAP }}>
        {slices.map((s) => {
          const pct = (s.value / total) * 100;
          return (
            <motion.div
              key={s.key}
              {...grow({ scaleX: 0 }, { scaleX: 1 }, { duration: 0.6, ease: "easeOut" })}
              // The real width from the first paint; the growing is a
              // transform laid over it, for the reason above.
              style={{ background: s.color, width: `${pct}%`, transformOrigin: "left" }}
              className="h-full cursor-default first:rounded-l-lg last:rounded-r-lg"
              onMouseEnter={(e) => {
                const r = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
                const b = e.currentTarget.getBoundingClientRect();
                setTip({
                  x: b.left - r.left + b.width / 2,
                  y: 0,
                  text: `${s.label} · ${format(s.value)} · ${Math.round(pct)}%`,
                });
              }}
              onMouseLeave={() => setTip(null)}
            />
          );
        })}
      </div>
      {tip && <Tooltip tip={tip} width={9999} />}

      <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        {slices.map((s) => (
          <li key={s.key} className="flex items-baseline gap-2 text-xs">
            <span
              className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ background: s.color }}
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate text-navy-600">{s.label}</span>{" "}
            <span className="font-display font-semibold text-navy-900">{format(s.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Magnitude comparison, one hue — horizontal so long labels stay readable. */
export function BarList({
  rows,
  format,
  accent = "#2a78d6",
}: {
  rows: { key: string; label: string; value: number; sub?: string }[];
  format: (n: number) => string;
  accent?: string;
}) {
  const grow = useGrow();
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((r) => (
        <li key={r.key}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
            <span className="min-w-0 truncate font-medium text-navy-900">{r.label}</span>{" "}
            {/* The spaces are for whoever is reading this as text rather than
                looking at it: between flex items a whitespace-only node is not
                rendered, so the layout is untouched and copying the row stops
                producing "VorbereitungCHF 2’132". */}
            <span className="shrink-0 text-navy-600">
              {r.sub && <><span>{r.sub}</span> </>}
              <span className="font-display font-semibold text-navy-900">{format(r.value)}</span>
            </span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-navy-200/50">
            <motion.div
              {...grow({ scaleX: 0 }, { scaleX: 1 }, { duration: 0.6, ease: "easeOut" })}
              className="h-full rounded-full"
              style={{
                background: accent,
                width: `${(r.value / max) * 100}%`,
                transformOrigin: "left",
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Spend per day as columns, with the average drawn as a reference line. */
export function DailyColumns({
  data,
  format,
  formatDate,
  average,
  accent = "#2a78d6",
  height = 170,
}: {
  data: { date: string; amount: number }[];
  format: (n: number) => string;
  formatDate: (d: string) => string;
  average: number;
  accent?: string;
  height?: number;
}) {
  const grow = useGrow();
  const { tip, setTip } = useTooltip();
  const max = Math.max(...data.map((d) => d.amount), average, 1);
  const avgPct = (average / max) * 100;

  return (
    <div className="relative">
      <div className="relative flex items-end gap-1.5" style={{ height }}>
        {/* average reference line */}
        <div
          className="pointer-events-none absolute inset-x-0 border-t border-dashed"
          style={{ bottom: `${avgPct}%`, borderColor: MUTED }}
          aria-hidden
        />
        <span
          className="pointer-events-none absolute right-0 -translate-y-1/2 rounded bg-cream-50 px-1 text-[11px] font-medium text-navy-600"
          style={{ bottom: `${avgPct}%` }}
        >
          ø {format(average)}
        </span>

        {data.map((d, i) => {
          const pct = max > 0 ? (d.amount / max) * 100 : 0;
          return (
            // The *column* is the button, not the bar. When the bar was the
            // button, a quiet day was a 23×2px target — two pixels of height,
            // which is unhittable with a thumb and barely hittable with a
            // mouse. The column is the chart's full height, so every day is
            // reachable whatever it cost, and the drawn bar is now a span
            // inside it with no hit testing of its own.
            <button
              key={d.date}
              type="button"
              className="flex h-full flex-1 items-end"
              onMouseEnter={(e) => {
                const wrap = e.currentTarget.closest("div.relative") as HTMLElement;
                const r = wrap.getBoundingClientRect();
                const bar = e.currentTarget.firstElementChild as HTMLElement;
                const b = bar.getBoundingClientRect();
                setTip({
                  x: b.left - r.left + b.width / 2,
                  y: b.top - r.top,
                  text: `${formatDate(d.date)} · ${format(d.amount)}`,
                });
              }}
              onMouseLeave={() => setTip(null)}
              aria-label={`${formatDate(d.date)}: ${format(d.amount)}`}
            >
              <motion.span
                {...grow(
                  { scaleY: 0 },
                  { scaleY: 1 },
                  { duration: 0.5, delay: Math.min(i * 0.02, 0.3), ease: "easeOut" },
                )}
                className="block w-full rounded-t"
                style={{
                  background: accent,
                  height: `${Math.max(pct, 1)}%`,
                  minHeight: 2,
                  transformOrigin: "bottom",
                }}
              />
            </button>
          );
        })}
      </div>
      {tip && <Tooltip tip={tip} width={9999} />}

      <div className="mt-2 flex justify-between text-[11px] text-navy-600">
        <span>{data.length > 0 && formatDate(data[0].date)}</span>
        <span>{data.length > 0 && formatDate(data.at(-1)!.date)}</span>
      </div>
    </div>
  );
}

/** Cumulative spend — a single-series area, so one hue, no legend needed. */
export function CumulativeArea({
  data,
  format,
  formatDate,
  accent = "#2a78d6",
  height = 180,
  reference,
}: {
  data: { date: string; cumulative: number }[];
  format: (n: number) => string;
  formatDate: (d: string) => string;
  accent?: string;
  height?: number;
  /** A planned-spend line drawn behind the real one, same length as `data`. */
  reference?: { values: number[]; label: string };
}) {
  const grow = useGrow();
  const gradId = useId();
  const { tip, setTip } = useTooltip();
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const W = 600;
  const H = height;
  const PAD = { t: 10, r: 8, b: 18, l: 8 };
  // The budget line has to be inside the scale, or being under budget would
  // push it off the top of the plot.
  const max = Math.max(...data.map((d) => d.cumulative), ...(reference?.values ?? []), 1);
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;

  const pt = (i: number, v: number) => [
    PAD.l + (data.length === 1 ? innerW / 2 : (i / (data.length - 1)) * innerW),
    PAD.t + innerH - (v / max) * innerH,
  ];

  const line = data.map((d, i) => pt(i, d.cumulative).join(",")).join(" L");
  const area = `M${PAD.l},${PAD.t + innerH} L${line} L${PAD.l + innerW},${PAD.t + innerH} Z`;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block h-auto w-full"
        role="img"
        aria-label="Cumulative spend"
        onMouseLeave={() => {
          setTip(null);
          setHoverIdx(null);
        }}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const x = ((e.clientX - r.left) / r.width) * W;
          const i = Math.round(((x - PAD.l) / innerW) * (data.length - 1));
          const idx = Math.min(Math.max(i, 0), data.length - 1);
          const [px, py] = pt(idx, data[idx].cumulative);
          setHoverIdx(idx);
          setTip({
            x: (px / W) * r.width,
            y: (py / H) * r.height,
            text: `${formatDate(data[idx].date)} · ${format(data[idx].cumulative)}`,
          });
        }}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={accent} stopOpacity={0.28} />
            <stop offset="100%" stopColor={accent} stopOpacity={0.02} />
          </linearGradient>
        </defs>

        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line
            key={f}
            x1={PAD.l}
            x2={PAD.l + innerW}
            y1={PAD.t + innerH - f * innerH}
            y2={PAD.t + innerH - f * innerH}
            stroke={GRID}
            strokeWidth={1}
          />
        ))}

        {reference && reference.values.length === data.length && (
          <motion.path
            d={`M${reference.values.map((v, i) => pt(i, v).join(",")).join(" L")}`}
            fill="none"
            stroke={MUTED}
            strokeWidth={1.5}
            strokeDasharray="5 4"
            strokeLinecap="round"
            {...grow({ opacity: 0 }, { opacity: 0.85 }, { duration: 0.7, delay: 0.3 })}
          />
        )}

        <motion.path
          d={area}
          fill={`url(#${gradId})`}
          {...grow({ opacity: 0 }, { opacity: 1 }, { duration: 0.7 })}
        />
        <motion.path
          d={`M${line}`}
          fill="none"
          stroke={accent}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          {...grow({ pathLength: 0 }, { pathLength: 1 }, { duration: 0.9, ease: "easeOut" })}
        />

        {hoverIdx !== null &&
          (() => {
            const [px, py] = pt(hoverIdx, data[hoverIdx].cumulative);
            return (
              <>
                <line x1={px} y1={PAD.t} x2={px} y2={PAD.t + innerH} stroke={MUTED} strokeWidth={1} />
                <circle cx={px} cy={py} r={5} fill={accent} stroke={SURFACE} strokeWidth={2} />
              </>
            );
          })()}
      </svg>
      {tip && <Tooltip tip={tip} width={9999} />}

      <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-3 text-[11px] text-navy-600">
        <span>{data.length > 0 && formatDate(data[0].date)}</span>
        {reference && (
          <span className="flex items-center gap-1.5">
            <svg width="20" height="5" aria-hidden>
              <line
                x1="0"
                y1="2.5"
                x2="20"
                y2="2.5"
                stroke={MUTED}
                strokeWidth="1.5"
                strokeDasharray="5 4"
              />
            </svg>
            {reference.label}
          </span>
        )}
        <span className="font-display font-semibold text-navy-900">
          {data.length > 0 && format(data.at(-1)!.cumulative)}
        </span>
      </div>
      <span className="sr-only" style={{ color: INK }} />
    </div>
  );
}
