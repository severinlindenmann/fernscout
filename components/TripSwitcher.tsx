"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, Luggage } from "lucide-react";
import { useI18n } from "./LocaleProvider";
import { useSite } from "./SiteProvider";
import { useTrip } from "./TripProvider";
import { useTripList } from "./TripListProvider";
import type { TripStatus } from "@/lib/types";

const GROUPS: { status: TripStatus; key: "trips.now" | "trips.upcoming" | "trips.past" }[] = [
  { status: "current", key: "trips.now" },
  { status: "upcoming", key: "trips.upcoming" },
  { status: "past", key: "trips.past" },
];

/**
 * Which page of a trip we're on, so switching trips keeps you on the same
 * kind of page: /map → /trips/x/map, not /trips/x.
 *
 * Day permalinks are the exception — a day slug means nothing in another
 * trip, so they fall back to that trip's story.
 */
function pageSuffix(pathname: string): string {
  const rest = pathname.replace(/^\/trips\/[^/]+/, "");
  for (const page of ["/map", "/gallery", "/costs"]) {
    if (rest === page || rest.startsWith(`${page}/`)) return page;
  }
  return "";
}

export default function TripSwitcher() {
  const { t, localizedTrip } = useI18n();
  const pathname = usePathname();
  const active = useTrip();
  // Every in-site URL carries the owner; without this the switcher links to
  // paths that do not exist.
  const { base: userBase } = useSite();
  const trips = useTripList();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Nothing to switch between.
  if (trips.length < 2) return null;

  const suffix = pageSuffix(pathname);
  const currentId = trips.find((tr) => tr.status === "current")?.id;
  const label = active ? localizedTrip(active.trip).title : t("trips.allTrips");

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("trips.switch")}
        className="flex min-h-11 items-center gap-1 rounded-full border border-navy-200 bg-white px-3 text-sm font-semibold text-navy-700 transition-colors hover:border-navy-500 sm:w-[14rem] sm:justify-between"
      >
        {/* The icon carries the meaning when the label cannot.

            Below sm there isn't room for both this label and the nav's icons
            without the header itself overflowing (max-w-[10rem] still forced
            it wide enough to push the total past 375px), so the label is
            hidden there — which left a bare chevron next to two other round
            buttons, saying nothing about what it opens. A chevron is a
            direction, not a subject. The `aria-label` had it right all along;
            this gives a sighted reader the same sentence. */}
        <span className="flex min-w-0 items-center gap-1">
          <Luggage className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
          <span className="hidden truncate sm:inline">{label}</span>
        </span>
        {/* A fixed width (B286) rather than a cap: the button's width used to
            follow the active trip's own title, so two trips with different
            name lengths made the header wrap the nav to its own line at
            different desktop widths — the row's fit calculation depends on
            every child's width, this one included. `justify-between` keeps
            the chevron pinned to the fixed box's right edge on a short title
            rather than drifting in next to a short label. */}
        <ChevronDown className="h-3.5 w-3.5 shrink-0" strokeWidth={2.5} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-2 w-60 overflow-hidden rounded-2xl border border-navy-200 bg-white shadow-lg"
        >
          {GROUPS.map(({ status, key }) => {
            const group = trips.filter((tr) => tr.status === status);
            if (group.length === 0) return null;
            return (
              <div key={status} className="border-b border-navy-200 last:border-b-0">
                <p className="px-3 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wide text-navy-600">
                  {t(key)}
                </p>
                {group.map((tr) => {
                  const href =
                    tr.id === currentId
                      ? `${userBase}${suffix}` || "/"
                      : `${userBase}/trips/${tr.id}${suffix}`;
                  const isActive = tr.id === active?.trip.id;
                  return (
                    <Link
                      key={tr.id}
                      href={href}
                      role="menuitem"
                      onClick={() => setOpen(false)}
                      aria-current={isActive ? "true" : undefined}
                      className={`block px-3 py-2 text-sm transition-colors ${
                        isActive
                          ? "bg-yellow-400 font-semibold text-yellow-950"
                          : "text-navy-700 hover:bg-cream-100"
                      }`}
                    >
                      <span className="block truncate">{localizedTrip(tr).title}</span>
                      <span className="block text-[11px] text-navy-600">
                        {tr.start.slice(0, 4)}
                        {tr.end.slice(0, 4) !== tr.start.slice(0, 4)
                          ? `–${tr.end.slice(0, 4)}`
                          : ""}
                      </span>
                    </Link>
                  );
                })}
              </div>
            );
          })}
          <Link
            href={`${userBase}/trips`}
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block px-3 py-2.5 text-sm font-semibold text-navy-700 transition-colors hover:bg-cream-100"
          >
            {t("trips.allTrips")} →
          </Link>
        </div>
      )}
    </div>
  );
}
