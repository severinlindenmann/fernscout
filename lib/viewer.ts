import "server-only";
import { isOwner, journalReader } from "./contacts/session";
import { isPersonOnWith, redeemedTripsFor } from "./tripPeople";
import { getTrips } from "./trips";
import { getUser } from "./users";
import type { Trip } from "./types";

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
  /** Why they can see it — what the panel says beside each one. */
  through: "public" | "traveller" | "guest";
};

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

function describe(trip: Trip, through: ViewerTrip["through"], current: string | undefined): ViewerTrip {
  return {
    id: trip.id,
    title: trip.title,
    href: trip.id === current ? `/${trip.username}` : `/${trip.username}/trips/${trip.id}`,
    through,
  };
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

  const trips = getTrips(username);
  const current = trips.find((t) => t.status === "current")?.id;
  // Every trip this reader was let onto by a buddy link, in one query. Asking
  // per trip inside the loop below would be a round trip per row of a list
  // that renders on an ordinary page view.
  const redeemed = await redeemedTripsFor(username, email);

  const visible: ViewerTrip[] = [];
  for (const trip of trips) {
    // The order matters: it decides which reason the panel shows, and being
    // on a trip is a better answer than "you were invited to it".
    if (owner || isPersonOnWith(trip, email, redeemed)) {
      visible.push(describe(trip, "traveller", current));
    } else if (trip.visibility === "public" && trip.listed) {
      visible.push(describe(trip, "public", current));
    } else if (trip.visibility === "guest" && guest) {
      // A guest of the *journal*, and nothing narrower: this arm used to also
      // ask `grants?.has(trip.id)`, a per-trip grant nothing ever issued,
      // removed with the column in `007-journal-wide-grants`. A trip held back
      // from the people who are otherwise let in is `private`, and `private`
      // never reaches here.
      visible.push(describe(trip, "guest", current));
    }
  }

  return { email, name: contact?.name ?? undefined, owner, guest, trips: visible };
}
