import "server-only";
import { isIndexable } from "./access";
import { getContactByEmail } from "./contacts";
import { getAllEntries } from "./entries";
import { hasReadGrant } from "./grants";
import { getTrips } from "./trips";
import { getUser, getUsernames, listedUsernames } from "./users";
import { tripsVisibleTo, type ViewerTrip } from "./viewer";

/**
 * What one address may open, across every journal on this instance — B411.
 *
 * The question `/` could not previously ask. Every resolver before this one
 * starts from `fs_session`, which has already picked a journal, so "what may
 * this person open?" had no query behind it. B410's identity credential
 * supplies an address that belongs to no journal, and this turns it into a
 * list.
 *
 * **It enumerates journals, and that is deliberate.** `listedUsernames()` is
 * the wrong list here: it excludes a journal whose config says `guest`, which
 * is exactly the kind of journal somebody is most likely to have been invited
 * into. So this walks `getUsernames()` and keeps only the ones where the
 * address holds a role — which discloses nothing, because a journal the
 * address has no role in is dropped before it is ever named.
 *
 * The cost is one pass per journal on the instance, with two indexed queries
 * for each. That is fine at the scale this runs at — a handful of journals on
 * a VPS — and it is the reason this is not cached anywhere: the answer changes
 * the moment an owner approves somebody, and a stale "you have no journals" is
 * worse than a query.
 */

export type HomeRole = "owner" | "traveller" | "guest";

export type HomeJournal = {
  username: string;
  title: string;
  tagline: string;
  href: string;
  /**
   * How this address gets in, at the journal level.
   *
   * The strongest reason wins, in the order owner → traveller → guest, which
   * is `ViewerTrip.through`'s order and for the same reasoning (B80): the one
   * to print is the one that would survive the others being edited away.
   * `public` is not a value here — a journal you can only read the public
   * trips of is not *yours*, and listing it under "your journals" would be a
   * claim about access nobody granted. Those are in the public list instead.
   */
  role: HomeRole;
  /** The trips this address may open here, each with its own reason. */
  trips: ViewerTrip[];
};

export type PublicJournalSummary = {
  username: string;
  title: string;
  tagline: string;
  trips: number;
  cover?: string;
};

/** A journal's first public photograph, for a preview card. */
export function coverFor(username: string): string | undefined {
  for (const trip of getTrips(username).filter(isIndexable)) {
    for (const entry of getAllEntries(trip.ref)) {
      const image = entry.gallery.find((item) => item.type === "image");
      if (image) return image.src;
    }
  }
  return undefined;
}

/**
 * The journals this instance advertises to anybody — today's landing list.
 *
 * Unchanged behaviour, moved here so that the page and the home endpoint read
 * one function rather than two copies of the same three filters.
 */
export function publicJournals(): PublicJournalSummary[] {
  return listedUsernames().flatMap((username) => {
    const user = getUser(username);
    if (!user) return [];
    const trips = getTrips(username).filter(isIndexable);
    // A journal with nothing public has nothing to show a stranger.
    if (trips.length === 0) return [];
    return [
      {
        username,
        title: user.title,
        tagline: user.tagline,
        trips: trips.length,
        cover: coverFor(username),
      },
    ];
  });
}

/**
 * Every journal this address holds a role in.
 *
 * Nothing here decides what may be *read* — `tripsVisibleTo` does that, and it
 * is the same function `/<user>/me` renders from, so the home view and the
 * per-journal panel cannot come to different answers about one trip. A journal
 * where the address turns out to see nothing but public trips is dropped: it
 * belongs in the public list, not in "yours".
 */
export async function journalsFor(email: string): Promise<HomeJournal[]> {
  const out: HomeJournal[] = [];

  for (const username of getUsernames()) {
    const user = getUser(username);
    if (!user) continue;

    const owner = Boolean(user.owner.email) && user.owner.email === email;

    // Asked only when it can change the answer. A journal the address owns is
    // already in at the strongest level, and two indexed queries per journal
    // per page view is worth avoiding when the result cannot matter.
    let guest = false;
    if (!owner) {
      const contact = await getContactByEmail(username, email);
      guest = Boolean(
        contact && contact.status === "active" && (await hasReadGrant(username, contact.id)),
      );
    }

    const trips = await tripsVisibleTo(username, { email, owner, guest });

    // The journal-level reason, strongest first. `traveller` is read off the
    // trips rather than asked separately: being on a trip *is* what makes
    // somebody a traveller here, and asking again would be a second answer to
    // the same question.
    const role: HomeRole | null = owner
      ? "owner"
      : trips.some((t) => t.through === "traveller")
        ? "traveller"
        : guest
          ? "guest"
          : null;

    // No role, or a role that opens nothing: not one of *their* journals.
    if (!role) continue;
    if (trips.length === 0) continue;

    out.push({
      username,
      title: user.title,
      tagline: user.tagline,
      href: `/${username}`,
      role,
      trips,
    });
  }

  // Owner first, then traveller, then guest; alphabetical inside each. The
  // person's own journal is the one they came for.
  const order: Record<HomeRole, number> = { owner: 0, traveller: 1, guest: 2 };
  return out.sort(
    (a, b) => order[a.role] - order[b.role] || a.title.localeCompare(b.title),
  );
}
