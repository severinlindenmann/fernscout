"use client";

import { motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Plane, TrainFront, Bus, Bike, Car, Ship, Footprints, Backpack } from "lucide-react";
import { flagFor } from "@/lib/flags";
import { useI18n } from "./LocaleProvider";
import { useMoney } from "./CurrencyProvider";
import type { DaySummary, TransportMode } from "@/lib/types";

const ICON = {
  flight: Plane,
  train: TrainFront,
  bus: Bus,
  motorbike: Bike,
  car: Car,
  boat: Ship,
  walk: Footprints,
} as const;

/**
 * How many nodes either side of the visible band are drawn.
 *
 * The path is one absolutely-positioned button per day, each with its own
 * icon — around 600 bytes of markup apiece. Drawing all of them put a five
 * month trip's entire sidebar in the first response for the sake of the
 * handful you can actually see. The container keeps its full height either
 * way, so the scrollbar and the scroll position are unaffected.
 */
const OVERSCAN = 12;

type Point = { x: number; y: number };

function smoothPath(points: Point[]) {
  if (points.length < 2) return "";
  let d = `M ${points[0].x},${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    const p0 = points[i - 1];
    const p1 = points[i];
    const mid = (p0.y + p1.y) / 2;
    d += ` C ${p0.x},${mid} ${p1.x},${mid} ${p1.x},${p1.y}`;
  }
  return d;
}

/** Nearest vertically-scrolling ancestor, stopping before the document — so
 * we never move the page itself. */
function findScrollParent(el: HTMLElement): HTMLElement | null {
  let node = el.parentElement;
  while (node && node !== document.body) {
    const style = getComputedStyle(node);
    if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

function iconFor(day: DaySummary) {
  const mode = day.transport?.mode as TransportMode | undefined;
  return mode ? (ICON[mode] ?? Backpack) : Backpack;
}

/** The winding day path. Desktop sidebar only — on mobile the days are a
 * plain list (see MobileDaySheet), which a cramped horizontal strip could
 * never be. */
export default function GamePath({
  days,
  currentIndex,
  onSelect,
}: {
  days: DaySummary[];
  currentIndex: number;
  onSelect?: (date: string) => void;
}) {
  const { t, formatShortDate } = useI18n();
  const { money } = useMoney();
  const activeRef = useRef<HTMLButtonElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const NODE = 46;
  // Two lines of label under each node rather than one, so the spacing is set
  // by what has to fit between two circles: 46 of node, ~4 of gap, and two
  // lines of small type. At 78 the date collided with the node below it.
  const SPACING = 96;
  const AMPLITUDE = 34;
  const CENTER = 78;
  const PAD = 40;

  const points = useMemo(
    () =>
      days.map((_, i) => ({
        x: CENTER + AMPLITUDE * Math.sin(i * 0.95),
        y: PAD + i * SPACING,
      })),
    [days],
  );

  const pathD = useMemo(() => smoothPath(points), [points]);

  const width = CENTER * 2;
  const height = PAD * 2 + (days.length - 1) * SPACING;

  /**
   * What the sidebar has been scrolled over, once it has been scrolled.
   *
   * Null until then, which is also what the server renders — the band around
   * the day being read is enough for the first paint, and it is where the
   * sidebar scrolls itself to anyway.
   */
  const [scrolled, setScrolled] = useState<{ from: number; to: number } | null>(null);

  // Follow the sidebar's own scrolling, so days appear as they are scrolled
  // to rather than only when selected.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const scroller = findScrollParent(root);
    if (!scroller) return;

    const recompute = () => {
      const top = scroller.scrollTop - root.offsetTop;
      const first = Math.floor((top - PAD) / SPACING) - OVERSCAN;
      const last = Math.ceil((top + scroller.clientHeight - PAD) / SPACING) + OVERSCAN;
      const from = Math.max(0, Math.min(first, days.length));
      const to = Math.max(from, Math.min(last + 1, days.length));
      setScrolled((prev) => (prev && prev.from === from && prev.to === to ? prev : { from, to }));
    };

    scroller.addEventListener("scroll", recompute, { passive: true });
    return () => scroller.removeEventListener("scroll", recompute);
  }, [days.length]);

  // Keep the active node in view *inside the path's own scroller only*.
  // `scrollIntoView` would also scroll every ancestor — including the window —
  // which fought the reader for control of the page as they scrolled.
  useEffect(() => {
    const el = activeRef.current;
    if (!el) return;

    const scroller = findScrollParent(el);
    if (!scroller) return;

    const target = el.offsetTop - scroller.clientHeight / 2 + el.offsetHeight / 2;
    const max = scroller.scrollHeight - scroller.clientHeight;
    scroller.scrollTo({ top: Math.min(Math.max(target, 0), max), behavior: "smooth" });
  }, [currentIndex]);

  /**
   * The nodes actually drawn: whatever has been scrolled over, plus a band
   * around the current day. The current day is always in it even when the
   * reader has scrolled the sidebar far away from it — dropping it would drop
   * the anchor the auto-scroll above uses.
   */
  const drawn = useMemo(() => {
    const from = Math.max(0, Math.min(scrolled?.from ?? days.length, currentIndex - OVERSCAN));
    const to = Math.min(
      days.length,
      Math.max(scrolled?.to ?? 0, currentIndex + OVERSCAN + 1),
    );
    const out: number[] = [];
    for (let i = from; i < to; i++) out.push(i);
    return out;
  }, [scrolled, currentIndex, days.length]);

  return (
    <div ref={rootRef} className="relative mx-auto" style={{ width, height }}>
      <svg width={width} height={height} className="absolute inset-0" aria-hidden>
        <path
          d={pathD}
          fill="none"
          stroke="var(--color-navy-200)"
          strokeWidth={8}
          strokeLinecap="round"
        />
      </svg>

      {drawn.map((i) => {
        const day = days[i];
        const isCurrent = i === currentIndex;
        const isPast = i < currentIndex;
        const size = isCurrent ? NODE + 8 : NODE;
        const { x, y } = points[i];
        const Icon = iconFor(day);
        const flag = flagFor(day.country, day.countryCode);

        return (
          <motion.button
            key={day.date}
            ref={isCurrent ? activeRef : undefined}
            onClick={() => onSelect?.(day.date)}
            whileTap={{ scale: 0.92 }}
            aria-current={isCurrent ? "true" : undefined}
            title={`${day.location} — ${day.date}`}
            className="absolute flex flex-col items-center"
            style={{ left: x - size / 2, top: y - size / 2, width: size }}
          >
            <span className="relative">
              <span
                className={`flex items-center justify-center rounded-full border-b-4 shadow-sm transition-colors ${
                  isCurrent
                    ? "border-yellow-600 bg-yellow-400 text-yellow-950"
                    : isPast
                      ? "border-green-700 bg-green-500 text-white"
                      : "border-navy-200 bg-white text-navy-700"
                }`}
                style={{ width: size, height: size }}
              >
                <Icon className="h-[46%] w-[46%]" strokeWidth={2} />
              </span>
              {flag && (
                <span
                  className="absolute -right-1 -top-1 rounded-full bg-white px-0.5 shadow-sm"
                  style={{ fontSize: size * 0.3, lineHeight: 1.1 }}
                >
                  {flag}
                </span>
              )}
              {/*
                Which day of the trip this is — the thing the mobile list has
                always led with and the path had nowhere. Navy in every state
                rather than coloured like the mobile badge, because here the
                node itself already carries current/past/ahead and a second
                coloured thing on the same circle only competes with it.

                Sized by its content, not fixed: day 7 and day 118 both happen.
              */}
              <span className="absolute -bottom-0.5 -left-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-navy-900 px-1 text-[9px] font-bold tabular-nums text-white shadow-sm">
                {i + 1}
              </span>
            </span>
            <span
              className={`mt-1 max-w-[104px] truncate font-display text-xs font-semibold ${
                isCurrent ? "text-navy-900" : "text-navy-600"
              }`}
            >
              {day.location}
            </span>
            {/* The same second line the mobile day list draws. */}
            <span className="max-w-[112px] truncate text-[10px] leading-tight text-navy-600 tabular-nums">
              {formatShortDate(day.date)}
              {day.updates > 1 && ` · ${day.updates} ${t("day.updates")}`}
              {day.cost > 0 && ` · ${money(day.cost)}`}
            </span>
          </motion.button>
        );
      })}
    </div>
  );
}
