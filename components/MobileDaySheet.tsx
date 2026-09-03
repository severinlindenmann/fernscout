"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
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
  const { money } = useMoney();
  const [open, setOpen] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const activeRef = useRef<HTMLButtonElement | null>(null);

  // Bring the current day into view within the list only — never the page.
  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    const el = activeRef.current;
    if (!list || !el) return;
    list.scrollTop = Math.max(0, el.offsetTop - list.clientHeight / 2 + el.offsetHeight / 2);
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
    <div className="sticky bottom-0 z-30 border-t border-navy-200 bg-cream-100/95 shadow-[0_-8px_24px_rgba(30,41,59,0.12)] backdrop-blur lg:hidden">
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: CLOSE_MS / 1000, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="flex gap-2 border-b border-navy-200 px-4 py-2">
              <button
                onClick={() => {
                  onOverview();
                  setOpen(false);
                }}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold transition-colors ${
                  onOverviewActive
                    ? "bg-navy-900 text-white"
                    : "border border-navy-200 bg-white text-navy-700"
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
              className="no-scrollbar max-h-[46vh] overflow-y-auto overscroll-contain border-b border-navy-200"
            >
              <ul className="divide-y divide-navy-200/70">
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
                          window.setTimeout(() => onSelect(day.date), CLOSE_MS + 40);
                        }}
                        aria-current={isCurrent ? "true" : undefined}
                        className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                          isCurrent ? "bg-yellow-400/20" : "active:bg-cream-50"
                        }`}
                      >
                        <span
                          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-display text-xs font-bold ${
                            isCurrent
                              ? "bg-yellow-400 text-yellow-950"
                              : isPast
                                ? "bg-green-500 text-white"
                                : "bg-white text-navy-600 ring-1 ring-navy-200"
                          }`}
                        >
                          {i + 1}
                        </span>

                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-navy-900">
                            {flagFor(day.country, day.countryCode)} {day.location}
                          </span>
                          <span className="block text-[11px] text-navy-600">
                            {formatShortDate(day.date)}
                            {day.updates > 1 && ` · ${day.updates} ${t("day.updates")}`}
                            {cost > 0 && ` · ${money(cost)}`}
                          </span>
                        </span>

                        {isCurrent && (
                          <Check className="h-4 w-4 shrink-0 text-yellow-950" aria-hidden />
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

      <div className="flex items-center gap-2 px-3 py-2">
        <button
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={open ? t("day.hideDays") : t("day.chooseDay")}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-xl px-1 py-1 text-left transition-colors active:bg-cream-50"
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate font-display text-sm font-semibold text-navy-900">
              {flagFor(current.country, current.countryCode)} {current.location}
            </span>
            <span className="block text-[11px] text-navy-600">
              {formatShortDate(current.date)} · {t("day.label")} {currentIndex + 1}{" "}
              {t("day.of")} {days.length}
            </span>
          </span>
          {open ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-navy-600" />
          ) : (
            <ChevronUp className="h-4 w-4 shrink-0 text-navy-600" />
          )}
        </button>

        <PagerNav state={nav} compact />
      </div>
    </div>
  );
}
