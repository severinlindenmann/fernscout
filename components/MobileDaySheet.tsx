"use client";

import { useEffect, useRef, useState } from "react";
import {
  AnimatePresence,
  motion,
  animate,
  useDragControls,
  useMotionValue,
  useReducedMotion,
} from "motion/react";
import { ChevronUp, ChevronDown, Check, LayoutDashboard } from "lucide-react";
import LatestDayButton from "./LatestDayButton";
import PagerNav, { type PagerNavState } from "./PagerNav";
import { useI18n } from "./LocaleProvider";
import { flagFor } from "@/lib/flags";
import { useMoney } from "./CurrencyProvider";
import type { DaySummary } from "@/lib/types";

/** Sheet collapse duration, shared by the animation and the deferred scroll. */
const CLOSE_MS = 220;

/**
 * The whole bottom bar on mobile: Back, which day you're on, and Continue —
 * plus the day list when you tap the middle. Paging and day-picking used to be
 * two stacked bars eating the bottom of the screen; they're one now.
 *
 * The winding path stays on desktop. Squeezed into a horizontal strip it
 * overlapped itself and needed a sideways scrollbar to reach anything.
 */
export default function MobileDaySheet({
  days,
  currentIndex,
  onSelect,
  onLatest,
  onOverview,
  showLatest,
  onOverviewActive,
  tripOver,
  nav,
}: {
  days: DaySummary[];
  currentIndex: number;
  onSelect: (date: string) => void;
  /** Jump to the day the story lands on — today, or the last day of a trip
   * that is over. See LatestDayButton. */
  onLatest: () => void;
  onOverview: () => void;
  showLatest: boolean;
  onOverviewActive: boolean;
  /** Whether the trip has finished, which is all that decides what the jump
   * button above the day list calls itself. */
  tripOver: boolean;
  nav: PagerNavState;
}) {
  const { t, formatShortDate } = useI18n();
  const { spend } = useMoney();
  const [open, setOpen] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const activeRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const dragControls = useDragControls();
  const reducedMotion = useReducedMotion();
  // Tracks the sheet's own drag offset (not React state — every frame would
  // re-render the whole list otherwise) so the scrim can fade with it and
  // snap back to 0 when a drag doesn't clear the close threshold.
  const dragY = useMotionValue(0);
  const scrimOpacity = useMotionValue(0);

  useEffect(() => {
    const controls = animate(scrimOpacity, open ? 0.38 : 0, {
      duration: reducedMotion ? 0 : CLOSE_MS / 1000,
      ease: "easeOut",
    });
    return () => controls.stop();
  }, [open, reducedMotion, scrimOpacity]);

  // Each open is a fresh AnimatePresence mount of the panel; without this the
  // drag offset from the drag that just closed it would still be sitting on
  // the motion value and the next open would render already dragged away.
  useEffect(() => {
    if (open) dragY.set(0);
  }, [open, dragY]);

  // Bring the current day into view within the list only — never the page.
  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    const el = activeRef.current;
    if (!list || !el) return;
    list.scrollTop = Math.max(
      0,
      el.offsetTop - list.clientHeight / 2 + el.offsetHeight / 2,
    );
  }, [open, currentIndex]);

  // Close on Escape, like any other overlay.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const current = days[currentIndex];
  if (!current) return null;

  return (
    <>
      {/* The page behind dims while the sheet is open, and fades with the
          drag so pulling the sheet down previews the page coming back —
          B2327. Always mounted (not gated by AnimatePresence) so its opacity
          can track the drag motion value directly; pointer-events follow
          `open` so it never blocks the page while invisible. */}
      <motion.button
        type="button"
        aria-hidden={!open}
        tabIndex={-1}
        onClick={() => setOpen(false)}
        style={{ opacity: scrimOpacity, pointerEvents: open ? "auto" : "none" }}
        className="fixed inset-0 z-20 bg-overlay-strong lg:hidden"
      />
      {/* A floating island above the home indicator rather than a bar flush on
      the edge — B2161, the owner's pick C. The bar used to sit on the swipe
      strip with its pills in the rounded corners; an inset pill clears both
      and is what iOS reading apps do now. `fixed` rather than `sticky` so
      the inset is from the viewport, and `bottom` is the safe-area inset
      minus 14px (about 20pt on an iPhone, B2168 — the full inset floated it
      too high) or 8px, whichever is larger, plus the showcase bar's height on a demo
      journal (`--fs-showcase-bar`, the same variable the body pads by) so
      the pill rides above that bar instead of under it. The day list still
      opens upward inside the same island. The story wrapper pads its bottom
      to clear the pill. */}
      <div className="fixed inset-x-3 bottom-[calc(max(0.5rem,env(safe-area-inset-bottom,0px)-0.875rem)+var(--fs-showcase-bar,0px))] z-30 overflow-hidden rounded-[1.75rem] border border-line-quiet bg-surface-subtle/95 shadow-[0_10px_30px_rgba(30,41,59,0.18)] backdrop-blur lg:hidden">
        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              ref={panelRef}
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{
                duration: reducedMotion ? 0 : CLOSE_MS / 1000,
                ease: "easeOut",
              }}
              className="overflow-hidden"
              style={{ y: dragY }}
              drag="y"
              dragControls={dragControls}
              dragListener={false}
              dragConstraints={{ top: 0 }}
              dragElastic={{ top: 0.4, bottom: 1 }}
              dragMomentum={false}
              onDragEnd={(_e, info) => {
                const height = panelRef.current?.offsetHeight ?? 300;
                const pastThreshold =
                  info.offset.y > height * 0.25 || info.velocity.y > 500;
                if (pastThreshold) {
                  setOpen(false);
                } else if (!reducedMotion) {
                  animate(dragY, 0, {
                    type: "spring",
                    stiffness: 400,
                    damping: 36,
                  });
                } else {
                  dragY.set(0);
                }
              }}
            >
              {/* The grab handle — the only part of the sheet that starts a
                drag, so the list underneath keeps scrolling normally. */}
              <div
                onPointerDown={(e) => dragControls.start(e)}
                className="flex touch-none justify-center pt-1.5 pb-0.5"
              >
                <span
                  className="h-1 w-9 rounded-full bg-line-quiet"
                  aria-hidden
                />
              </div>
              <div className="flex gap-2 border-b border-line-quiet px-4 py-2">
                <button
                  onClick={() => {
                    onOverview();
                    setOpen(false);
                  }}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold transition-colors ${
                    onOverviewActive
                      ? "bg-action-strong text-on-action"
                      : "border border-line-quiet bg-surface-raised text-ink-body"
                  }`}
                >
                  <LayoutDashboard className="h-3.5 w-3.5" />
                  {t("nav.overview")}
                </button>
                {showLatest && (
                  <LatestDayButton
                    tripOver={tripOver}
                    onClick={() => {
                      onLatest();
                      setOpen(false);
                    }}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-yellow-400 px-3 py-2 text-xs font-semibold text-yellow-950"
                    iconClassName="h-3.5 w-3.5"
                  />
                )}
              </div>
              <div
                ref={listRef}
                className="no-scrollbar max-h-[46vh] overflow-y-auto overscroll-contain border-b border-line-quiet"
              >
                <ul className="divide-y divide-line-quiet/70">
                  {days.map((day, i) => {
                    const isCurrent = i === currentIndex;
                    const isPast = i < currentIndex;
                    const cost = day.cost;
                    return (
                      <li key={day.date}>
                        <button
                          ref={isCurrent ? activeRef : undefined}
                          onClick={() => {
                            setOpen(false);
                            // Scroll only once the sheet has finished collapsing:
                            // the layout change during the exit animation cancels
                            // an in-flight smooth scroll, leaving the page put.
                            window.setTimeout(
                              () => onSelect(day.date),
                              CLOSE_MS + 40,
                            );
                          }}
                          aria-current={isCurrent ? "true" : undefined}
                          className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                            isCurrent
                              ? "bg-yellow-400/20"
                              : "active:bg-surface-base"
                          }`}
                        >
                          <span
                            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-display text-xs font-bold ${
                              isCurrent
                                ? "bg-yellow-400 text-yellow-950"
                                : isPast
                                  ? "bg-green-500 text-on-bright"
                                  : "bg-surface-raised text-ink-secondary ring-1 ring-line-quiet"
                            }`}
                          >
                            {i + 1}
                          </span>

                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-ink-strong">
                              {flagFor(day.country, day.countryCode)}{" "}
                              {day.location}
                            </span>
                            <span className="block text-[11px] text-ink-secondary">
                              {formatShortDate(day.date)}
                              {day.updates > 1 &&
                                ` · ${day.updates} ${t("day.updates")}`}
                              {/* What was actually paid leads, converted beside
                                it — same figures as the story feed. B544. */}
                              {cost > 0 && ` · ${spend(cost, day.costLocal)}`}
                            </span>
                          </span>

                          {isCurrent && (
                            <Check
                              className="h-4 w-4 shrink-0 text-yellow-950"
                              aria-hidden
                            />
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex items-center gap-2 py-2 pl-4 pr-2">
          <button
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-label={open ? t("day.hideDays") : t("day.chooseDay")}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-xl px-1 py-1 text-left transition-colors active:bg-surface-base"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate font-display text-sm font-semibold text-ink-strong">
                {flagFor(current.country, current.countryCode)}{" "}
                {current.location}
              </span>
              <span className="block text-[11px] text-ink-secondary">
                {formatShortDate(current.date)} · {t("day.label")}{" "}
                {currentIndex + 1} {t("day.of")} {days.length}
              </span>
            </span>
            {open ? (
              <ChevronDown className="h-4 w-4 shrink-0 text-ink-secondary" />
            ) : (
              <ChevronUp className="h-4 w-4 shrink-0 text-ink-secondary" />
            )}
          </button>

          <PagerNav state={nav} compact />
        </div>
      </div>
    </>
  );
}
