import "server-only";
import { isOwner, journalReader } from "./contacts/session";
import { getAllEntries } from "./entries";
import { stripMarkdown } from "./markdownText";
import type { ReaderLevel } from "./photos";
import { isPersonOnWith, redeemedTripsFor } from "./tripPeople";
import { getTrips } from "./trips";
import { getUser } from "./users";
import type { Entry, Trip, TripStatus } from "./types";

/**
 * Who is asking, and what that entitles them to see.
 *
 * One resolver, because the answer is assembled from four unrelated places —
 * the session cookie, the journal's `owner.email`, each trip's `people:` block
 * and the contacts table — and working that out separately on each page is how
 * two pages start disagreeing about whether somebody is a guest.
 *
 * Read-only. Nothing here grants access; `mayReadTrip` still decides that per
 * page. This exists so a reader can be *told* what they already have, which
 * is the one thing the site could not do: a guest who loses the email they
 * were sent has, until now, no way to find their way back in.
 */

export type ViewerTrip = {
  id: string;
  title: string;
  href: string;
  /** past/current/upcoming, and when a past trip ended — B2463's
   *  `OfflineTrips` needs both to pick which trips "Save recent trips
   *  automatically" keeps, without a second trip lookup. */
  status: TripStatus;
  end: string;
  /**
   * Why they can see it — what the panel says beside each one.
   *
   * `owner` and `traveller` are two different facts and were one arm until
   * B80: the journal is yours, or you were on this particular trip. They come
   * apart in the ordinary case — a trip in your journal you did not travel,
   * or a `test: true` one nobody did — and the panel was asserting the second
   * whenever the first was true.
   */
  through: "public" | "owner" | "traveller" | "guest";
  /**
   * True when this reader's own level (B596/B632) leaves some of this trip's
   * days out — an update marked `guest` or `private` beyond what they have
   * proved. Absent rather than `false`, so a trip nobody has held anything
   * back on prints nothing extra.
   *
   * The point of this list is to tell a reader what they can read; a row that
   * says "you can read this trip" while quietly omitting days it has held
   * back is the same half-true shape B41 found in this file once already —
   * a panel answering a different, easier question than the one it looks
   * like it is answering.
   */
  partial?: true;
  /**
   * What `/` shows about the trip — B2508. Only `journalsFor` asks for it
   * (`tripsVisibleTo(..., { detail: true })`); every other caller gets the
   * rows exactly as before. Each field is read at this reader's own level,
   * so a photograph or day they may not see never names itself here, and
   * each is absent rather than guessed when there is nothing to show.
   */
  start?: string;
  /** The chosen cover, else the newest photograph this reader may see. */
  cover?: string;
  /** Distinct dates written about that this reader may read. */
  days?: number;
  /** The newest day this reader may read. */
  latest?: HomeDay & { image?: string; excerpt?: string };
  /** The owner's newest unpublished day — only on `through: "owner"`. */
  draft?: HomeDay;
  /** A `test: true` trip — nobody lived it, so `/` never offers it as a book. */
  test?: true;
};

type HomeDay = { slug: string; title: string; date: string; href: string };

/** How much of a day's text `/` quotes — a teaser, not the day. */
const EXCERPT = 180;

function newestFirst(entries: Entry[]): Entry[] {
  return [...entries].sort((a, b) =>
    `${b.date}${b.time ?? ""}`.localeCompare(`${a.date}${a.time ?? ""}`),
  );
}

function detailFor(trip: Trip, through: ViewerTrip["through"], level: ReaderLevel) {
  const read = newestFirst(getAllEntries(trip.ref, { reader: level }));
  const day = (entry: Entry): HomeDay => ({
    slug: entry.slug,
    title: entry.title,
    date: entry.date,
    href: `/${trip.username}/trips/${trip.id}/day/${entry.slug}`,
  });
  const imageOf = (entry: Entry) => entry.gallery.find((item) => item.type === "image")?.src;
  const cover = trip.cover ?? read.map(imageOf).find(Boolean);
  const latest = read[0];
  const text = latest ? stripMarkdown(latest.content) : "";
  const image = latest && imageOf(latest);
  // Drafts are the owner's alone — a traveller reads at `person` too, but
  // publishing is not theirs, so an unpublished day is not named to them.
  const draft =
    through === "owner"
      ? newestFirst(getAllEntries(trip.ref, { includeDrafts: true, reader: "person" })).find((e) => e.draft)
      : undefined;
  return {
    start: trip.start,
    ...(cover ? { cover } : {}),
    days: new Set(read.map((e) => e.date)).size,
    ...(latest
      ? {
          latest: {
            ...day(latest),
            ...(image ? { image } : {}),
            ...(text ? { excerpt: text.length > EXCERPT ? `${text.slice(0, EXCERPT).trimEnd()}…` : text } : {}),
          },
        }
      : {}),
    ...(draft ? { draft: day(draft) } : {}),
    ...(trip.test ? { test: true as const } : {}),
  };
}

export type Viewer = {
  /** Null when nobody is signed in. */
  email: string | null;
  name?: string;
  /** True when this is the journal's owner. */
  owner: boolean;
  /** True when they hold a confirmed contact record here. */
  guest: boolean;
  /** Trips they may open, and how. Public ones included, so the list is the
   * whole answer to "what can I read?" rather than half of it. */
  trips: ViewerTrip[];
};

function describe(
  trip: Trip,
  through: ViewerTrip["through"],
  current: string | undefined,
  level: ReaderLevel,
  detail = false,
): ViewerTrip {
  // `level` is the finer-grained answer `readerLevelFor` (lib/tripGate.ts)
  // would give for this exact trip and viewer — recomputed the cheap way
  // here from facts `tripsVisibleTo` already has, rather than asked of a
  // session a second time. Comparing counts at that level against the
  // unfiltered count is the same question `visible()` in lib/entries.ts
  // answers per day, just asked once for the row rather than once per day.
  const partial =
    level !== "person" &&
    getAllEntries(trip.ref, { reader: level }).length <
      getAllEntries(trip.ref, { reader: "person" }).length;
  return {
    id: trip.id,
    title: trip.title,
    href: trip.id === current ? `/${trip.username}` : `/${trip.username}/trips/${trip.id}`,
    status: trip.status,
    end: trip.end,
    through,
    ...(partial ? { partial: true as const } : {}),
    ...(detail ? detailFor(trip, through, level) : {}),
  };
}

/**
 * What a reader's standing in one journal is, before any trip is considered.
 *
 * Three facts, from three unrelated places — `config.json`'s `owner.email`, the
 * contacts table plus a live grant, and the address itself. Split out from
 * `resolveViewer` for B411, which asks the same question of every journal on
 * the instance for one address and therefore cannot go through the cookie.
 */
export type Standing = {
  /** The address asking, or null for a stranger. */
  email: string | null;
  /** True when this is the journal's owner. */
  owner: boolean;
  /** True when they hold a live `read` grant here. */
  guest: boolean;
};

/**
 * The trips one standing may see, and why — the loop that was inside
 * `resolveViewer`.
 *
 * Pulled out whole rather than reimplemented, which is the point: B411 needs
 * this answer for every journal an address touches, and a second copy of these
 * four arms is how the home view and the trip gate would start disagreeing
 * about who may open what. B41 is the record of what that costs.
 */
export async function tripsVisibleTo(
  username: string,
  { email, owner, guest }: Standing,
  { detail = false }: { detail?: boolean } = {},
): Promise<ViewerTrip[]> {
  const trips = getTrips(username);
  const current = trips.find((t) => t.status === "current")?.id;
  // Every trip this reader was let onto by a buddy link, in one query. Asking
  // per trip inside the loop below would be a round trip per row of a list
  // that renders on an ordinary page view.
  const redeemed = await redeemedTripsFor(username, email);

  const visible: ViewerTrip[] = [];
  for (const trip of trips) {
    // The order matters: it decides which reason the panel shows, and the
    // truest answer goes first. Owning the journal beats having been on the
    // trip, which beats having been invited to it.
    //
    // Owner first, and not only because both can be true at once: it is the
    // fact that actually opens the trip. `isPersonOn` counts the owner's
    // address whatever `people:` says (lib/tripPeople.ts), so an owner
    // dropping themselves from `people:` tomorrow changes nothing about their
    // access — and a reason that would survive that edit is the one to print.
    // B80; before it these two shared an arm and every trip in the owner's own
    // journal, travelled or not, read "you were on this trip".
    //
    // The traveller arm asks `isPersonOnWith`, so somebody who arrived by a
    // buddy link (B33) reads the same as somebody typed into `people:` — the
    // redeemed rows come from the one query above, not one per trip.
    if (owner) {
      visible.push(describe(trip, "owner", current, "person", detail));
    } else if (isPersonOnWith(trip, email, redeemed)) {
      visible.push(describe(trip, "traveller", current, "person", detail));
    } else if (trip.visibility === "public" && trip.listed) {
      // A `public` trip is open whether or not this reader has proved
      // anything — but an approved guest of the journal reads its own
      // `guest`-labelled updates too (the same branch `readerLevelFor` takes
      // for a trip that is not `private`), so their actual level here is
      // `"guest"`, not `"public"`, whatever `through` says for the row.
      visible.push(describe(trip, "public", current, guest ? "guest" : "public", detail));
    } else if (trip.visibility === "guest" && guest) {
      // A guest of the *journal*, and nothing narrower: this arm used to also
      // ask `grants?.has(trip.id)`, a per-trip grant nothing ever issued,
      // removed with the column in `007-journal-wide-grants`. A trip held back
      // from the people who are otherwise let in is `private`, and `private`
      // never reaches here.
      visible.push(describe(trip, "guest", current, "guest", detail));
    }
  }
  return visible;
}

export async function resolveViewer(username: string): Promise<Viewer> {
  const user = getUser(username);
  if (!user) return { email: null, owner: false, guest: false, trips: [] };

  // The session, the contact record and the answer to "have they been let in?"
  // — all three from `journalReader`, which is also what `mayReadTrip` asks.
  // The panel computing its own answer is exactly how this page came to list
  // trips the gate then refused (B41).
  const { email, contact, guest } = await journalReader(username);
  const owner = await isOwner(username);

  return {
    email,
    name: contact?.name ?? undefined,
    owner,
    guest,
    trips: await tripsVisibleTo(username, { email, owner, guest }),
  };
}
