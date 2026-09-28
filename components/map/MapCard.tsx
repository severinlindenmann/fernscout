"use client";

import Link from "next/link";
import { useI18n } from "../LocaleProvider";
import type { TripCard } from "@/lib/map/tripCard";

/**
 * The still preview card — B2538. One presentational component for both the
 * trip hero (`TripHero.tsx`, the whole route) and a single day's own screen
 * (`StoryPager.tsx`'s `DayCard`, that day's line and place only): the SVG
 * `card.card.svg` already differs between the two (`lib/map/tripCard.ts`
 * picks `tripCardFor` or `dayCardFor`), so this component only has to lay
 * out what surrounds it once.
 *
 * The SVG string is server-rendered and cached (`lib/map/cardSvg.ts`) —
 * `dangerouslySetInnerHTML` is safe here because nothing in it is
 * reader-supplied markup: every place name is escaped by the renderer
 * before it ever reaches disk, and the only other content is coordinates
 * turned into path data.
 */
export default function MapCard({
  card,
  mapHref,
  factsLine,
}: {
  card: TripCard;
  mapHref: string;
  /** Pre-joined ("4 days · 4 places · 12 km recorded") — callers differ on
   * which facts apply (a day has no "days" count of its own), so this
   * component only renders whatever line it is handed. */
  factsLine?: string;
}) {
  const { t } = useI18n();
  return (
    <div className="mt-4">
      <Link href={mapHref} className="block overflow-hidden rounded-2xl border border-line-quiet">
        <div
          className="w-full [&_svg]:block [&_svg]:h-auto [&_svg]:w-full"
          dangerouslySetInnerHTML={{ __html: card.card.svg }}
        />
      </Link>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
        {factsLine ? <p className="text-ink-secondary">{factsLine}</p> : <span />}
        <Link href={mapHref} className="font-semibold text-ink-strong hover:text-ink-body">
          {t("mapCard.openMap")}
        </Link>
      </div>
      {card.card.usedStreet && (
        <p className="mt-1 text-xs text-ink-secondary">{t("mapCard.osmCredit")}</p>
      )}
    </div>
  );
}
