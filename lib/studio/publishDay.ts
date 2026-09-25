import "server-only";
import { missingAtPublish } from "@/lib/api/v2/days";
import { readDayFile, resolveDayStem } from "@/lib/api/v2/store";
import { isEnabled } from "@/lib/capabilities";
import { listContacts, type ContactRecord } from "@/lib/contacts";
import { AS_AUTHOR, getAllEntries } from "@/lib/entries";
import { contactsWithReadGrant } from "@/lib/grants";
import { peopleOf } from "@/lib/tripPeople";
import { getTrip, getTrips, tripRef } from "@/lib/trips";
import { getUser } from "@/lib/users";

/**
 * "Publish a day" (B2140) — the rows its list shows, read server-side.
 *
 * `audience` is who can read the day once it is up: the trip's own gate,
 * narrowed by the day's own `visibility` (which only ever narrows — the
 * schema has no "public" for a day). A public trip that is `listed: false`
 * or marked test is kept out of the feed and search, so it reads
 * "anyone with the link" rather than "anyone".
 */
type PublishAudience = "public" | "link" | "guest" | "private";

export type PublishRow = {
  tripId: string;
  tripTitle: string;
  /** The bare entry slug — what the day's page and the web door address. */
  slug: string;
  title: string;
  date: string;
  photos: number;
  audience: PublishAudience;
};

/** `status` "draft" lists what can be published; "published" what can be taken down. */
export function daysToPublish(username: string, status: "draft" | "published"): PublishRow[] {
  const rows: PublishRow[] = [];
  for (const trip of getTrips(username)) {
    for (const entry of getAllEntries(tripRef(username, trip.id), AS_AUTHOR)) {
      if (Boolean(entry.draft) !== (status === "draft")) continue;
      const narrowest = entry.visibility === "private" || trip.visibility === "private"
        ? "private"
        : entry.visibility === "guest" || trip.visibility === "guest"
          ? "guest"
          : trip.listed && !trip.test && !entry.test
            ? "public"
            : "link";
      rows.push({
        tripId: trip.id,
        tripTitle: trip.title,
        slug: entry.slug,
        // Empty when untitled — the flow says the long date, never an ISO string.
        title: entry.title || "",
        date: entry.date,
        photos: entry.gallery.length,
        audience: narrowest,
      });
    }
  }
  return rows.sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * B2192 (D3) — the declinables this draft still has neither filled in nor
 * answered: exactly the list the publish itself would refuse on
 * (`missingAtPublish`), which the share sheet names and the owner's tap
 * records as left blank.
 */
export function blankFieldsOf(username: string, row: PublishRow): string[] {
  const stem = resolveDayStem(username, row.tripId, row.slug);
  const day = stem ? readDayFile(username, row.tripId, stem) : null;
  if (!day) return [];
  return missingAtPublish(day, getUser(username)?.locales ?? []).map((m) => m.field);
}

/**
 * B2192 — who, by name, can read the day once it is up, the owner left out.
 * `null` for a public or link day: "anyone" has no names. A private day is
 * the people on the trip (`peopleOf`: named in the file, or given a place);
 * a guest day adds everyone let into the journal (an active contact holding
 * a live read grant — `journalReader`'s own two conditions). A name is the
 * trip's nickname or name for that address, else the contact's name, else
 * the address itself — this is the owner's own page.
 */
export async function readersOf(username: string, row: PublishRow): Promise<string[] | null> {
  if (row.audience === "public" || row.audience === "link") return null;
  const trip = getTrip(tripRef(username, row.tripId));
  if (!trip) return [];
  const addresses = new Set(await peopleOf(trip));
  let contacts: ContactRecord[] = [];
  if (isEnabled("contacts", username)) {
    contacts = await listContacts(username).catch(() => []);
    if (row.audience === "guest") {
      const live = await contactsWithReadGrant(username, new Date()).catch(() => new Set<string>());
      for (const c of contacts) if (c.status === "active" && live.has(c.id)) addresses.add(c.email);
    }
  }
  const own = getUser(username)?.owner.email?.trim().toLowerCase();
  if (own) addresses.delete(own);
  return [...addresses].map((email) => {
    const person = trip.people.find((p) => p.email === email);
    return person?.nickname || person?.name || contacts.find((c) => c.email === email)?.name || email;
  });
}
