"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useI18n } from "../LocaleProvider";

/**
 * The still preview card — B2538. One presentational component for both the
 * trip hero (`TripHero.tsx`, the whole route) and a single day's own screen
 * (`StoryPager.tsx`'s `DayCard`, that day's line and place only).
 *
 * The SVG is fetched as an ordinary `<img src>` from `/@<user>/card.svg`
 * (or the trip-scoped equivalent), never inlined — item 3 of the B2538
 * follow-up: a day the pager loads client-side (paging past the window the
 * server rendered) reaches the same route the server-rendered day already
 * used, so it gets a card too. Because an `<img>`'s SVG is a separate
 * document with no access to this page's stylesheet, the route bakes
 * concrete colours per theme (`lib/map/cardPalette.ts`) rather than
 * `var(--map-…)` tokens — this component reads the reader's actual theme
 * the same way `components/map/StreetMap.tsx` already does, and asks for
 * that one.
 */
function currentScheme(): "light" | "dark" {
  if (typeof document === "undefined") return "light";
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "light" || attr === "dark") return attr;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** The reader's theme, followed live — the card is an `<img>` and cannot
 *  read this page's stylesheet, so it has to be asked for by name. */
function useScheme(): "light" | "dark" {
  const [scheme, setScheme] = useState<"light" | "dark">("light");
  useEffect(() => {
    const update = () => setScheme(currentScheme());
    update();
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    media.addEventListener("change", update);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", update);
    };
  }, []);
  return scheme;
}

export default function MapCard({
  src,
  query = "",
  mapHref,
  factsLine,
  usedStreet,
}: {
  /** `<trip base>/card.svg`, e.g. `active.href("/card.svg")` — no query. */
  src: string;
  /** `""` for the trip-wide card, `"?day=<date>"` for one day's own —
   * `lib/map/tripCard.ts`'s `CardMeta.query`. */
  query?: string;
  mapHref: string;
  /** Pre-joined ("4 days · 4 places · 12 km recorded") — callers differ on
   * which facts apply (a day has no "days" count of its own), so this
   * component only renders whatever line it is handed. */
  factsLine?: string;
  /** Whether this card's own render is expected to reach for street tiles
   * — `lib/map/tripCard.ts`'s `CardMeta.usedStreet` — so the credit line
   * shows without this component waiting on the image itself to answer. */
  usedStreet: boolean;
}) {
  const { t } = useI18n();
  const scheme = useScheme();

  const join = query ? "&" : "?";
  const imgSrc = `${src}${query}${join}theme=${scheme}`;

  return (
    <div className="mt-4">
      <Link href={mapHref} className="relative block overflow-hidden rounded-2xl border border-line-quiet bg-surface-raised">
        {/* eslint-disable-next-line @next/next/no-img-element -- a same-origin,
            reader-gated SVG route, not an optimisable photograph; Next's own
            image optimiser cannot pass a request with no cookies through the
            gate anyway (the same reasoning lib/media.ts's own doc gives). */}
        <img src={imgSrc} alt="" loading="lazy" className="block h-auto w-full" />
        {/* B2573 — the credit sits on the map it credits, bottom-left. */}
        {usedStreet && (
          <span className="absolute bottom-1.5 left-1.5 rounded bg-surface-raised/80 px-1.5 py-0.5 text-[10px] leading-none text-ink-secondary">
            {t("mapCard.osmCredit")}
          </span>
        )}
      </Link>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
        {factsLine ? <p className="text-ink-secondary">{factsLine}</p> : <span />}
        <Link href={mapHref} className="font-semibold text-ink-strong hover:text-ink-body">
          {t("mapCard.openMap")}
        </Link>
      </div>
    </div>
  );
}

/**
 * A day's map, as a row rather than a picture — B2570.
 *
 * The day card used to carry the full `MapCard` above: a street map the
 * width of the card and about as tall as it is wide on a phone, so on most
 * days it was the largest thing on the page and outweighed the photographs
 * and the words. The owner wanted it to stop being the focus. This is the
 * same image, the day's own `card.svg`, cut to a small square beside what
 * it is — the leg that brought the day here, or the place — and still one
 * tap from the whole map.
 */
export function MapRow({
  src,
  query,
  mapHref,
  detail,
  usedStreet,
}: {
  /** `<trip base>/card.svg` — see `MapCard`. */
  src: string;
  /** `"?day=<date>"`. */
  query: string;
  mapHref: string;
  /** "Car · Las Vegas → Springdale", or the place when there was no leg. */
  detail?: string;
  usedStreet: boolean;
}) {
  const { t } = useI18n();
  const scheme = useScheme();
  return (
    <div className="mt-6">
      <Link
        href={mapHref}
        className="flex max-w-md items-center gap-3 rounded-xl border border-line-faint p-2 hover:border-line-quiet"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- the same gated SVG route as MapCard's. */}
        <img
          src={`${src}${query}&theme=${scheme}`}
          alt=""
          loading="lazy"
          className="h-13 w-13 shrink-0 rounded-lg bg-surface-subtle object-cover"
        />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-ink-strong">{t("day.routeAndMap")}</span>
          {detail && <span className="block truncate text-xs text-ink-secondary">{detail}</span>}
        </span>
        <span aria-hidden className="pr-1.5 text-lg text-ink-strong">
          →
        </span>
      </Link>
      {usedStreet && <p className="mt-1 text-[11px] text-ink-secondary">{t("mapCard.osmCredit")}</p>}
    </div>
  );
}
