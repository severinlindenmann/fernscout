import type { Metadata } from "next";
import { headers } from "next/headers";
import { localeForPath, requestLocale, translateIn } from "@/lib/locales";
import { PATH_HEADER } from "@/lib/requestKeys";
import { basemapFor } from "@/lib/basemap";
import { CODE_TTL_MINUTES } from "@/lib/auth";
import { getPlaces, getTripStats } from "@/lib/entries";
import { frameRoute } from "@/lib/mapFrame";
import { getMalformedTrips, getTrips } from "@/lib/trips";
import { draftsVisibleTo, listableTrips, signedInAs } from "@/lib/tripGate";
import { isOwner } from "@/lib/contacts/session";
import { serverSite } from "@/lib/site";
import { getUser } from "@/lib/users";
import TripsIndexContent, { type EmptyJournal } from "./TripsIndexContent";

/**
 * Two languages on purpose.
 *
 * The tab title follows the *reader* — it lands in their history, their
 * bookmarks and their tab strip, and a German reader on a German journal was
 * getting "Gallery" there while the page in front of them said "Galerie".
 * The sharing card follows the *journal*, because the people who see one are
 * not this reader and their language is not knowable from this request.
 */
export async function generateMetadata(): Promise<Metadata> {
  const reader = await requestLocale();
  const journal = localeForPath((await headers()).get(PATH_HEADER));
  const description = translateIn(journal, "trips.subtitle");
  const shared = translateIn(journal, "trips.title");
  return {
    title: translateIn(reader, "trips.title"),
    description,
    alternates: { canonical: "/trips" },
    openGraph: { type: "website", title: shared, description, url: "/trips" },
    twitter: { card: "summary_large_image", title: shared, description },
  };
}

export default async function TripsPage({ params }: PageProps<"/[user]/trips">) {
  const { user } = await params;
  // Filtered by who is asking, not just fetched. The trip switcher in the user
  // layout has always run `listableTrips`; this page — the one actually called
  // "Trips" — did not, and listed every restricted trip's title, tagline,
  // dates, day and country counts, and drew its route on the lifetime map.
  const all = getTrips(user);
  const trips = await listableTrips(all);

  /*
   * Is there anything on this list, and is the person looking at it its
   * owner?
   *
   * Asked of `trips` — the filtered list — not `all`. A journal whose trips
   * this reader may not see is a full journal behind a silent filter (B44),
   * not an empty one, and used to be told nothing at all: four zeroes and no
   * sentence. B264 is why `trips.length` decides it now — a filtered-empty
   * reader gets told what to do (ask for an invite, or sign in), the same
   * words a genuinely-empty journal's stranger gets, because a signed-out
   * reader who could tell the two apart would be reading a fact about
   * somebody's private journal off the shape of the response. B117 already
   * refuses that trade for a closed trip's own name; this is the same refusal
   * for whether one exists at all.
   *
   * `isOwner` reads the session cookie, which `listableTrips` has already
   * read on this request — and this route is dynamic regardless, because both
   * that call and `generateMetadata`'s `headers()` make it so. There was no
   * static render to lose. The lookup still only happens on a page that has
   * nothing to list: `trips.length === 0` is a superset of the old
   * `all.length === 0`, so a journal with anything visible still pays nothing
   * for it.
   *
   * The owner's address is put in the payload only once `isOwner` has said
   * yes. A stranger's copy of this page does not contain it.
   */

  // Trips that are on disk but too broken to render. Read first, and used to
  // decide whether the owner question is worth asking at all: on a journal
  // where every trip parses and at least one is visible to this reader —
  // which is nearly all of them, nearly all the time — this page needs no
  // session lookup, and the list is already in hand from the same parse
  // `getTrips` just ran.
  const broken = getMalformedTrips(user);
  const owner = trips.length === 0 || broken.length > 0 ? await isOwner(user) : false;

  // Shown to the owner only: a stranger sees a malformed trip as simply
  // absent, the same as before B83. Decided before the empty state, because a
  // journal whose only trip is malformed is *not* empty — it must not be told
  // to hand an agent a prompt when the trip it is missing is one it has
  // already written.
  // Folder and reason only. The English `problem` on each is what the log and
  // the API carry; the page renders the reason translated, so sending the
  // sentence too would put a second copy of every message in the payload for
  // the browser to never read.
  const malformed = owner ? broken.map(({ folder, reason }) => ({ folder, reason })) : [];

  let empty: EmptyJournal | null = null;
  if (malformed.length === 0) {
    if (owner) {
      // Genuine emptiness — unchanged by B264. There is no button here, and a
      // trip is made by handing an agent the prompt below.
      if (all.length === 0) {
        empty = {
          owner: true,
          // For the handover prompt B283 renders here: the exchange call and
          // the status call both name this instance's own address, not
          // whatever host the owner reached it through.
          siteUrl: serverSite().url,
        };
      } else if (trips.length === 0) {
        // B270: a real trip, filtered out from under its own owner.
        // `listableTrips` refuses a `public, listed: false` trip to
        // *everyone*, owner included — `listed` is deliberately about
        // advertising, not about locking the owner out of their own file
        // (test/access-gate.test.ts asserts this for every viewer, owner
        // row included). So this is not the "there is no button" moment —
        // the trip exists and the owner wrote it — it needs its own
        // sentence instead of the genuinely-empty one above, and neither of
        // B264's four zeroes nor its stranger message, which would tell an
        // owner who has a trip that they have none.
        empty = { owner: true, siteUrl: serverSite().url, filtered: true };
      }
    } else if (trips.length === 0) {
      // Whether this journal is truly empty or just filtered to nothing is
      // exactly what must not reach this reader — see the block comment
      // above. `signedIn` is safe to tell apart: it is read off this
      // reader's own cookie, not probed from the journal, and only asked once
      // we already know there is nothing to show them.
      //
      // `ownerName` (B278) is a third value that is safe for the same reason
      // `siteUrl` is safe above: it is the journal's own
      // constant, read off `config.json`, and does not vary with what this
      // reader may or may not see. Nickname first — it is the short form the
      // journal already keeps for exactly this (B20) — and the title when a
      // journal has none, because a journal written before nicknames existed
      // must not turn "ask {name}" into "ask ".
      const journal = getUser(user);
      empty = {
        owner: false,
        signedIn: (await signedInAs(user)) !== null,
        ownerName: journal?.owner.nickname?.trim() || journal?.title || user,
      };
    }
  }
  // Upcoming trips have no entries, so they contribute nothing to the map or
  // the lifetime totals — only a card with a countdown.
  const travelled = trips.filter((t) => t.status !== "upcoming");

  // Who may see *this* trip's drafts — per trip, never per journal (B327), so
  // a traveller on one trip does not pull another trip's unfinished days onto
  // the lifetime map. B336: `getPlaces` used to be called below with no
  // options at all, always published-only, while the trip-scoped map and the
  // journal home page had long since widened for the owner and for
  // travellers — so the same viewer got a different marker count here than on
  // either of those pages, for the same days.
  const draftsByTrip = new Map(
    await Promise.all(
      travelled.map(async (t) => [t.ref, (await draftsVisibleTo(t)).visible] as const),
    ),
  );

  // getPlaces/getTripStats each re-read and re-derive from every entry file,
  // so each travelled trip is computed once here and reused below, rather
  // than once per card plus twice more for the lifetime totals.
  // Keyed and looked up by `ref` — `getPlaces`/`getTripStats` resolve a
  // directory from `<user>/<tripId>`, and a bare id silently reads nothing,
  // which showed here as every trip having 0 days, 0 countries and no route.
  const placesByTrip = new Map(
    travelled.map((t) => {
      const read = { includeDrafts: draftsByTrip.get(t.ref) ?? false };
      return [t.ref, getPlaces(t.ref, read)] as const;
    }),
  );
  const statsByTrip = new Map(
    travelled.map((t) => {
      const read = { includeDrafts: draftsByTrip.get(t.ref) ?? false };
      return [t.ref, getTripStats(t.ref, read)] as const;
    }),
  );

  const routes = travelled.map((trip) => ({
    id: trip.id,
    title: trip.title,
    accent: trip.accent,
    translations: trip.translations,
    points: placesByTrip
      .get(trip.ref)!
      .map((p) => ({ lat: p.lat, lng: p.lng, location: p.location })),
  }));

  const cards = trips.map((trip) => {
    const stats = statsByTrip.get(trip.ref);
    return {
      id: trip.id,
      title: trip.title,
      tagline: trip.tagline,
      cover: trip.cover,
      accent: trip.accent,
      status: trip.status,
      start: trip.start,
      end: trip.end,
      translations: trip.translations,
      // `tripDays`, not `dayCount`: the label says "days on the road", and
      // that is elapsed time, not the number of days somebody wrote about. A
      // fortnight with five entries is a fortnight.
      tripDays: stats?.tripDays ?? 0,
      countries: stats?.countries ?? 0,
      totalMedia: stats?.totalMedia ?? 0,
    };
  });

  const countries = new Set(
    travelled.flatMap((t) => placesByTrip.get(t.ref)!.map((p) => p.country).filter(Boolean)),
  );

  return (
    <TripsIndexContent
      trips={cards}
      routes={routes}
      // Every trip's points at once: the lifetime map frames all of them, so
      // the clip has to cover all of them too.
      //
      // Guarded on `routes`, not on the points, because that is the condition
      // the map itself is drawn on (TripsIndexContent) — a journal of trips
      // that were never geotagged still gets a world map, and a basemap for
      // it. A journal with nothing but upcoming trips draws no map, and was
      // paying 160 KB of clipped-to-nothing world for it (B85).
      basemap={routes.length > 0 ? basemapFor(frameRoute(routes.flatMap((r) => r.points))) : null}
      empty={empty}
      malformed={malformed}
      // The code-request form the empty state may show — see EmptyState.
      // Passed unconditionally, like every other page that offers it: it is
      // a global constant, not a per-reader or per-journal fact, so handing
      // it over costs nothing on the pages that never render the form.
      codeMinutes={CODE_TTL_MINUTES}
      lifetime={{
        countries: countries.size,
        days: travelled.reduce((n, t) => n + statsByTrip.get(t.ref)!.tripDays, 0),
        photos: travelled.reduce((n, t) => n + statsByTrip.get(t.ref)!.totalMedia, 0),
        trips: travelled.length,
      }}
    />
  );
}
