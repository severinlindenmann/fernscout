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
