import { journalPath } from "@/lib/journalPath";
import type { TranslationKey } from "@/lib/i18n";

/**
 * Where a studio page's back arrow goes — B2853. One level up, read from the
 * page's own address, always a real link to a fixed, named ancestor (B1728:
 * no history.back(), no ?back=). The header and the bottom bar both call this,
 * so they always name the same place.
 *
 * A page about one day or one trip goes up to that day's or trip's reader
 * page; a route nested under another goes to its URL parent; everything else
 * (lists, pickers, account pages) goes to the studio home. `known.tripId` is
 * for the one page whose address has no trip (`day/edit?slug=`) and whose
 * server render already looked the day up — it is never fetched for a label.
 */
export type StudioUp = { href: string; labelKey: TranslationKey };

type Query = { get(name: string): string | null };

const DATE_PREFIX = /^\d{4}-\d{2}-\d{2}-/;

export function studioUp(
  username: string,
  pathname: string,
  query: Query,
  known: { tripId?: string } = {},
): StudioUp {
  const base = journalPath(username);
  const prefix = `${base}/studio`;
  const studio: StudioUp = { href: prefix, labelKey: "nav.studio" };
  if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) return studio;
  const parts = pathname.slice(prefix.length).split("/").filter(Boolean).map(decodeURIComponent);
  const e = encodeURIComponent;
  const q = (name: string) => query.get(name) || undefined;

  const trip = (id?: string): StudioUp =>
    id ? { href: `${base}/trips/${e(id)}`, labelKey: "studio.up.trip" } : studio;
  const day = (tripId?: string, slug?: string): StudioUp =>
    tripId && slug
      ? { href: `${base}/trips/${e(tripId)}/day/${e(slug.replace(DATE_PREFIX, ""))}`, labelKey: "studio.up.day" }
      : trip(tripId);
  const [a, b, c] = parts;

  if (a === "location") {
    if (parts.length === 1) return studio;
    // location/<trip>/<date> goes up to that trip's routes page; every other
    // location page goes up to the routes list.
    const trailing = c && !["import", "history", "places"].includes(b) ? `/${e(b)}` : "";
    return { href: `${prefix}/location${trailing}`, labelKey: "studio.up.routes" };
  }
  if (a === "trip") {
    if (b === "roster") {
      const t = q("trip");
      return t ? { href: `${prefix}/trip?trip=${e(t)}`, labelKey: "studio.hub.item.tripEdit.title" } : studio;
    }
    if (!b || b === "visibility") return trip(q("trip"));
    return studio;
  }
  if (a === "plan" && b) return trip(b);
  if (a === "day") {
    if (b === "edit") return day(known.tripId, q("slug"));
    if (b === "preview") return trip(q("trip"));
    if (b === "share" || b === "publish") return day(q("trip"), q("day"));
  }
  return studio;
}
