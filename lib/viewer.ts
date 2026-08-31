import "server-only";
import { cookies } from "next/headers";
import { GUEST_COOKIE, resolveSession } from "./auth";
import { listContacts, normaliseEmail } from "./contacts";
import { readGrantsByContact } from "./digest/visibility";
import { isOwner } from "./contacts/session";
import { isPersonOn } from "./tripPeople";
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

  const jar = await cookies();
  const session = await resolveSession(jar.get(GUEST_COOKIE)?.value, "guest");
  const email = session?.owner === username ? session.email : null;

  const owner = await isOwner(username);
  // Looked up by address rather than by a token: this is somebody reading
  // their own site in a browser, not following a link out of an email.
  const contact = email
    ? ((await listContacts(username)).find((c) => c.email === normaliseEmail(email)) ?? null)
    : null;
  const guest = contact?.status === "active";
  const grants = contact ? (await readGrantsByContact(username, new Date())).get(contact.id) : undefined;

  const trips = getTrips(username);
  const current = trips.find((t) => t.status === "current")?.id;

  const visible: ViewerTrip[] = [];
  for (const trip of trips) {
    // The order matters: it decides which reason the panel shows, and being
    // on a trip is a better answer than "you were invited to it".
    if (owner || isPersonOn(trip, email)) {
      visible.push(describe(trip, "traveller", current));
    } else if (trip.visibility === "public" && trip.listed) {
      visible.push(describe(trip, "public", current));
    } else if (
      trip.visibility === "guest" &&
      // `grants?.has(trip.id)`: nothing in this codebase currently issues a
      // grant with a specific `trip_id` — the only insert (`approveContact`,
      // `lib/contacts/index.ts`) always writes `"*"`, so this arm cannot be
      // reached today. It stays rather than being trimmed to `guest` alone:
      // the schema (`access_grants`'s unique index on `trip_id`), the read
      // side here and `digestableTrips` (`lib/digest/visibility.ts`) already
      // treat a per-trip grant as a first-class case, so this is a live
      // placeholder for that write path landing, not a stray leftover.
      (guest || grants?.has(trip.id))
    ) {
      visible.push(describe(trip, "guest", current));
    }
  }

  return { email, name: contact?.name ?? undefined, owner, guest, trips: visible };
}
