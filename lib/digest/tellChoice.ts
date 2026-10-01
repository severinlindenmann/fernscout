import "server-only";
import { getDatabaseOrNull, nowIso } from "../db";
import { listContacts } from "../contacts";
import { listGroups } from "../contacts/groups";
import { isEnabled } from "../capabilities";
import { subscribersFor } from "../push";
import { AS_AUTHOR, getEntryBySlug } from "../entries";
import { getTrip } from "../trips";
import { mailReachesContacts } from "./dayLetter";

/**
 * Who to tell when a day goes up — TIX-6 phase 2.
 *
 * The owner picks reader groups on the studio's publish step; this turns that
 * pick into people (contact ids) on the server, remembers it per trip for the
 * next day, and says per person who would actually hear — so the step can
 * count before anything is sent. **It only ever narrows** who is told; who
 * may *read* the day is decided by its visibility, exactly as before.
 */

/** `"none"` stands for readers in no group (or in one since deleted). */
const NO_GROUP = "none";

/** `groups: null` is everyone — the old behaviour, and the default. */
export type TellChoice = { groups: string[] | null; mail: boolean };

export async function getTellChoice(owner: string, tripId: string): Promise<TellChoice | null> {
  const handle = await getDatabaseOrNull();
  if (!handle) return null;
  const row = await handle.db
    .selectFrom("tell_choices")
    .select(["groups", "mail"])
    .where("owner_id", "=", owner)
    .where("trip_id", "=", tripId)
    .executeTakeFirst();
  if (!row) return null;
  let groups: string[] | null = null;
  try {
    const parsed = row.groups === null ? null : (JSON.parse(row.groups) as unknown);
    groups = Array.isArray(parsed) ? parsed.filter((g): g is string => typeof g === "string") : null;
  } catch {
    groups = null;
  }
  return { groups, mail: Number(row.mail) === 1 };
}

export async function saveTellChoice(owner: string, tripId: string, choice: TellChoice): Promise<void> {
  const handle = await getDatabaseOrNull();
  if (!handle) return;
  const values = {
    groups: choice.groups === null ? null : JSON.stringify(choice.groups),
    mail: choice.mail ? 1 : 0,
    updated_at: nowIso(),
  };
  await handle.db
    .insertInto("tell_choices")
    .values({ owner_id: owner, trip_id: tripId, ...values })
    .onConflict((oc) => oc.columns(["owner_id", "trip_id"]).doUpdateSet(values))
    .execute();
}

/**
 * The owner's readers in these groups, as contact ids. Unknown ids (another
 * journal's, or one deleted since) match nobody; `NO_GROUP` matches readers
 * whose group is gone too, so nobody falls between the chips.
 */
export async function contactsInGroups(owner: string, groups: readonly string[]): Promise<Set<string>> {
  const known = new Set((await listGroups(owner)).map((group) => group.id));
  const wanted = new Set(groups);
  const out = new Set<string>();
  for (const contact of await listContacts(owner)) {
    const group = contact.groupId && known.has(contact.groupId) ? contact.groupId : NO_GROUP;
    if (wanted.has(group)) out.add(contact.id);
  }
  return out;
}

/** One reader this day could reach, and how. */
type TellPerson = { group: string; push: boolean; mail: boolean };

export type TellAudience = {
  people: TellPerson[];
  /** Devices that follow without an account — public trips only; told only
   *  when the owner tells everyone, since they are in no group. */
  anonymousPush: number;
  pushOn: boolean;
  mailOn: boolean;
};

/**
 * Who would hear about this day, per reader: through the same two functions
 * the sends themselves use (`subscribersFor`, the day letter's recipients),
 * so the count on the publish step is the count that goes out.
 */
export async function tellAudience(owner: string, ref: string, slug: string): Promise<TellAudience> {
  const trip = getTrip(ref);
  const entry = trip ? getEntryBySlug(ref, slug, AS_AUTHOR) : null;
  const pushOn = isEnabled("push");
  const mailOn = isEnabled("mail") && isEnabled("contacts", owner);
  if (!trip || !entry) return { people: [], anonymousPush: 0, pushOn, mailOn };

  const known = new Set((await listGroups(owner)).map((group) => group.id));
  const groupOf = new Map(
    (await listContacts(owner)).map((c) => [c.id, c.groupId && known.has(c.groupId) ? c.groupId : NO_GROUP]),
  );

  const pushIds = new Set<string>();
  let anonymousPush = 0;
  if (pushOn) {
    for (const sub of await subscribersFor(trip, { test: entry.test, visibility: entry.visibility })) {
      if (sub.isOwner) continue;
      if (sub.contactId) pushIds.add(sub.contactId);
      else anonymousPush += 1;
    }
  }
  const mailIds = new Set(mailOn ? await mailReachesContacts(owner, ref, slug) : []);

  const people: TellPerson[] = [];
  for (const id of new Set([...pushIds, ...mailIds])) {
    people.push({ group: groupOf.get(id) ?? NO_GROUP, push: pushIds.has(id), mail: mailIds.has(id) });
  }
  return { people, anonymousPush, pushOn, mailOn };
}
