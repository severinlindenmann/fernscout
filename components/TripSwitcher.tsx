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

const GROUPS: {
  status: TripStatus;
  key: "trips.now" | "trips.upcoming" | "trips.past";
}[] = [
  // Newest first, all the way down: what has not happened yet, then what is
  // happening, then the past in descending years. "Now" above "planned" was
  // the one step that read backwards.
  { status: "upcoming", key: "trips.upcoming" },
  { status: "current", key: "trips.now" },
  { status: "past", key: "trips.past" },
];

/** How many past trips the menu lists before deferring to "all trips" — B1766. */
const PAST_SHOWN = 4;

/**
 * The past trips this menu prints — B1766.
 *
 * A journal with nine trips turned the menu into a scroll, and only the past
 * list grows without bound, so only it is capped; the "all trips" link at the
 * foot is already the way to the rest. The trip being read is kept whatever
 * its position, so the menu never opens without the row it is marking active.
 *
 * Exported for the test: the menu itself only exists once somebody has pressed
 * the button, which a static render never does.
 */
export function pastShown<T extends { id: string }>(all: T[], activeId?: string): T[] {
  if (all.length <= PAST_SHOWN) return all;
  return [
    ...all.slice(0, PAST_SHOWN),
    ...all.slice(PAST_SHOWN).filter((tr) => tr.id === activeId),
  ];
}

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
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
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
        className="flex min-h-11 items-center gap-1 rounded-full border border-line-quiet bg-surface-raised px-3 text-sm font-semibold text-ink-body transition-colors hover:border-line-prominent sm:w-[14rem] sm:justify-between"
      >
        {/* What it does, not which trip is open — B886.

            B868 showed the trip's own title here, which is right on a laptop
            and wrong on a phone: "Achtzehn Tage, elf Parks" arrives as
            "Achtzehn Tage, elf …" and a truncated title says less than a
            fixed word. So below `sm` the chip carries the control's purpose
            and the title stays on the wider header, where there is room for
            it.

            The word is `trips.chip` — "Reisen" / "Trips" — asked for twice
            by the owner after "Reise wechseln" proved too long again on a
            phone. It repeats `nav.trips`, a destination in the same panel
            that lists every journey; that duplicate name is a real cost and
            was raised and overruled, which B886 records. The `aria-label`
            stays `trips.switch`, so a screen reader still hears what the
            control does rather than a word shared with something else. */}
        <span className="flex min-w-0 items-center gap-1">
          <Luggage className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
          <span className="truncate sm:hidden">{t("trips.chip")}</span>
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
          /* Anchored left below sm, where the button sits at the left edge of
             its row and a right-anchored 15rem menu hangs off the screen with
             no way to scroll it back. The width cap is for the narrowest
             phones, where 15rem plus the header's padding still would not
             fit. */
          className="fs-pop absolute left-0 right-auto z-40 mt-2 w-60 origin-top-left sm:origin-top-right max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-line-quiet bg-surface-raised shadow-lg sm:left-auto sm:right-0"
        >
          {GROUPS.map(({ status, key }) => {
            const all = trips.filter((tr) => tr.status === status);
            // Only the past list grows without bound, so only it is capped.
            const group =
              status === "past" ? pastShown(all, active?.trip.id) : all;
            if (group.length === 0) return null;
            return (
              <div
                key={status}
                className="border-b border-line-quiet last:border-b-0"
              >
                <p className="px-3 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-secondary">
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
                          : "text-ink-body hover:bg-surface-subtle"
                      }`}
                    >
                      <span className="block truncate">
                        {localizedTrip(tr).title}
                      </span>
                      <span
                        className={`block text-[11px] ${
                          isActive ? "text-yellow-950/80" : "text-ink-secondary"
                        }`}
                      >
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
            className="block px-3 py-2.5 text-sm font-semibold text-ink-body transition-colors hover:bg-surface-subtle"
          >
            {t("trips.allTrips")} →
          </Link>
        </div>
      )}
    </div>
  );
}
