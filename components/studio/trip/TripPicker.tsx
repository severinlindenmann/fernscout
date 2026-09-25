"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useI18n } from "@/components/LocaleProvider";

type PickTrip = { id: string; title: string };

/**
 * The trip picker — B2018, shared by Edit a trip and Who sees the plan
 * (B2071): a plain link per trip onto `<base>?trip=<id>`. Shown only while no
 * trip is chosen; once `?trip=` names one, the page collapses it.
 *
 * B2141: every studio trip picker is this one, with day/edit's search box
 * (`EditDayFlow`) over it — a journal with thirty trips was a flat list to
 * scroll. The search matches a trip's title or its address, as you type.
 * `row` lets a caller draw its own row (the photobook chooser's dates and
 * greyed trips); `shownByDefault` keeps the rest behind a "Show more" text
 * link under the list until one is searched for.
 */
export default function TripPicker<T extends PickTrip>({
  base,
  trips,
  row,
  shownByDefault,
}: {
  base?: string;
  trips: T[];
  row?: (trip: T) => ReactNode;
  shownByDefault?: number;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);
  const q = query.trim().toLowerCase();
  const matched = q ? trips.filter((trip) => trip.title.toLowerCase().includes(q) || trip.id.includes(q)) : trips;
  const cut = !q && !expanded && shownByDefault !== undefined && trips.length > shownByDefault;
  const shown = cut ? matched.slice(0, shownByDefault) : matched;

  return (
    <div className="mt-4">
      <label className="block text-xs font-semibold uppercase tracking-wide text-ink-secondary">
        {t("studio.tripPicker.searchLabel")}
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("studio.tripPicker.searchPlaceholder")}
          className="mt-1 block min-h-11 w-full rounded-xl border border-line-strong bg-surface-base px-3 text-sm text-ink-body"
        />
      </label>
      {shown.length === 0 && <p className="mt-4 text-sm text-ink-secondary">{t("studio.tripPicker.noMatches")}</p>}
      <ul className="mt-4 flex flex-col gap-3">
        {shown.map((trip) => (
          <li key={trip.id}>
            {row ? (
              row(trip)
            ) : (
              <Link
                href={`${base}?trip=${encodeURIComponent(trip.id)}`}
                className="block rounded-2xl border border-line-quiet bg-surface-raised px-5 py-4 transition-colors hover:bg-surface-subtle"
              >
                <span className="block font-display text-lg font-semibold text-ink-strong">{trip.title}</span>
                <span className="block text-xs text-ink-secondary">/{trip.id}</span>
              </Link>
            )}
          </li>
        ))}
      </ul>
      {cut && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-3 min-h-11 text-sm font-semibold text-ink-strong underline underline-offset-2"
        >
          {t("common.showMore")}
        </button>
      )}
    </div>
  );
}
