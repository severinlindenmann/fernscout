"use client";

import { useEffect, useRef } from "react";
import { mediaLoader } from "../mediaLoader";
import { useI18n } from "../LocaleProvider";
import type { TripStop } from "@/lib/tripMap";

/**
 * The stop-list rows (`TripMap`'s own `<ul>`) redrawn as a horizontal row of
 * cards for a phone — board 01's D1. Phase 2, item 4 of
 * docs/plans/map-redesign.md.
 *
 * Synced with the map's own selection both ways: a tap on a card calls the
 * same `onSelect` a marker tap does, and selecting on the map (a marker, the
 * step arrows) scrolls the matching card into view here. Real `<button>`s —
 * reachable by Tab, activated by Enter/Space, nothing built on `div`
 * `onClick` — and CSS scroll-snap rather than a JS carousel library.
 *
 * Phone-only (`sm:hidden`): the vertical list stays the desktop surface, and
 * the two are never both visible at once — see `TripMap`'s own `<ul>`, which
 * carries the matching `hidden sm:block`.
 */
export default function StopCarousel({
  stops,
  orderOf,
  selectedKey,
  onSelect,
}: {
  stops: readonly TripStop[];
  orderOf: Map<string, number>;
  selectedKey: string;
  onSelect: (stop: TripStop) => void;
}) {
  const { t, formatShortDate } = useI18n();
  const cards = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    cards.current.get(selectedKey)?.scrollIntoView({
      behavior: "smooth",
      inline: "center",
      block: "nearest",
    });
  }, [selectedKey]);

  return (
    <div
      role="list"
      aria-label={t("tripMap.title")}
      className="flex snap-x snap-mandatory gap-2 overflow-x-auto px-3 py-2 sm:hidden"
    >
      {stops.map((stop) => {
        const isSelected = stop.key === selectedKey;
        return (
          <button
            key={stop.key}
            type="button"
            role="listitem"
            ref={(el) => {
              if (el) cards.current.set(stop.key, el);
              else cards.current.delete(stop.key);
            }}
            aria-pressed={isSelected}
            onClick={() => onSelect(stop)}
            className={`flex w-28 shrink-0 snap-center flex-col overflow-hidden rounded-lg border text-left transition-colors ${
              isSelected
                ? "border-line-prominent bg-surface-selected"
                : "border-line-quiet bg-surface-raised"
            }`}
          >
            <span className="block h-16 w-full overflow-hidden bg-surface-muted">
              {stop.photo && (
                // A plain <img>, not next/image: this card is 112px wide and
                // the same `mediaLoader` the map's `PhotoMarker` and
                // `TripHero`'s cover both already resolve through — no
                // second image pipeline for one more thumbnail size.
                <img
                  src={mediaLoader({ src: stop.photo.src, width: 160 })}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              )}
            </span>
            <span className="truncate px-2 pt-1 text-xs font-semibold text-ink-strong">
              {orderOf.get(stop.key) ?? 1} · {stop.location}
            </span>
            <span className="truncate px-2 pb-1.5 text-[11px] text-ink-secondary">
              {formatShortDate(stop.date)}
              {stop.country ? ` · ${stop.country}` : ""}
            </span>
          </button>
        );
      })}
    </div>
  );
}
