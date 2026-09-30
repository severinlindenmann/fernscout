import "server-only";
import { getDatabase, newId, nowIso } from "../db";

/**
 * Reader groups — TIX-6. The owner's own labels ("Family", "Friends") for the
 * people who read along: one group per person, or none.
 *
 * **Who is told, never who can read.** Every rule about reading stays where it
 * was — a journal-wide `access_grants` row, and `visibility: private` as the
 * only way to hold a trip back (B35/B41). A group is a label the owner uses to
 * sort and, later, to tell some people rather than all; nothing here opens or
 * closes anything, and nothing here is ever shown to the person in the group.
 *
 * Every function takes the owner and checks that the group is theirs, so a
 * group id from another journal is simply not found — never applied.
 */

/** At most this many groups per journal. Enough for real life, small enough
 * that the filter chips stay one scrollable row. */
export const GROUP_LIMIT = 20;
/** Characters in a group's name. */
const GROUP_NAME_MAX = 30;
/** How many colours the UI's palette has; `color` is an index into it. */
const GROUP_COLORS = 6;

export type ReaderGroup = {
  id: string;
  name: string;
  color: number;
  sort: number;
};

export type GroupError = "invalid_name" | "duplicate_name" | "too_many" | "not_found";

/** The HTTP status each refusal is answered with, by every group door. */
export const GROUP_ERROR_STATUS: Record<GroupError, number> = {
  invalid_name: 400,
  duplicate_name: 409,
  too_many: 409,
  not_found: 404,
};

type Result<T> = { ok: true; value: T } | { ok: false; error: GroupError };

function cleanName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.replace(/\s+/g, " ").trim();
  if (name.length === 0 || name.length > GROUP_NAME_MAX) return null;
  return name;
}

function cleanColor(raw: unknown, fallback: number): number {
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 0 && raw < GROUP_COLORS ? raw : fallback;
}

export async function listGroups(owner: string): Promise<ReaderGroup[]> {
  const { db } = await getDatabase();
  const rows = await db
    .selectFrom("reader_groups")
    .select(["id", "name", "color", "sort"])
    .where("owner_id", "=", owner)
    .orderBy("sort")
    .orderBy("created_at")
    .execute();
  return rows.map((row) => ({ id: row.id, name: row.name, color: Number(row.color), sort: Number(row.sort) }));
}

/** The group, if it is this owner's; null for any other id. */
export async function ownGroupId(owner: string, id: unknown): Promise<string | null> {
  if (typeof id !== "string" || id === "") return null;
  const { db } = await getDatabase();
  const row = await db
    .selectFrom("reader_groups")
    .select("id")
    .where("owner_id", "=", owner)
    .where("id", "=", id)
    .executeTakeFirst();
  return row?.id ?? null;
}

export async function createGroup(owner: string, input: { name: unknown; color?: unknown }): Promise<Result<ReaderGroup>> {
  const name = cleanName(input.name);
  if (!name) return { ok: false, error: "invalid_name" };
  const existing = await listGroups(owner);
  if (existing.length >= GROUP_LIMIT) return { ok: false, error: "too_many" };
  if (existing.some((group) => group.name.toLowerCase() === name.toLowerCase())) {
    return { ok: false, error: "duplicate_name" };
  }
  const group: ReaderGroup = {
    id: newId(),
    name,
    color: cleanColor(input.color, existing.length % GROUP_COLORS),
    sort: existing.reduce((max, g) => Math.max(max, g.sort + 1), 0),
  };
  const { db } = await getDatabase();
  await db
    .insertInto("reader_groups")
    .values({ id: group.id, owner_id: owner, name: group.name, color: group.color, sort: group.sort, created_at: nowIso() })
    .execute();
  return { ok: true, value: group };
}

export async function updateGroup(
  owner: string,
  id: string,
  input: { name?: unknown; color?: unknown },
): Promise<Result<ReaderGroup>> {
  const groups = await listGroups(owner);
  const group = groups.find((g) => g.id === id);
  if (!group) return { ok: false, error: "not_found" };
  let name = group.name;
  if (input.name !== undefined) {
    const cleaned = cleanName(input.name);
    if (!cleaned) return { ok: false, error: "invalid_name" };
    if (groups.some((g) => g.id !== id && g.name.toLowerCase() === cleaned.toLowerCase())) {
      return { ok: false, error: "duplicate_name" };
    }
    name = cleaned;
  }
  const color = input.color === undefined ? group.color : cleanColor(input.color, group.color);
  const { db } = await getDatabase();
  await db.updateTable("reader_groups").set({ name, color }).where("owner_id", "=", owner).where("id", "=", id).execute();
  return { ok: true, value: { ...group, name, color } };
}

/**
 * Deletes the group and lets go of everybody in it — in one transaction, so a
 * half-done delete never leaves somebody pointing at a group that is gone.
 * **Nobody loses anything but the label**: their grant, their channels and
 * their place on every trip are untouched. Returns who was in it, so the page
 * can offer Undo.
 */
export async function deleteGroup(owner: string, id: string): Promise<Result<{ contactIds: string[]; inviteIds: string[] }>> {
  const { db } = await getDatabase();
  return db.transaction().execute(async (trx) => {
    const group = await trx
      .selectFrom("reader_groups")
      .select("id")
      .where("owner_id", "=", owner)
      .where("id", "=", id)
      .executeTakeFirst();
    if (!group) return { ok: false as const, error: "not_found" as const };
    const contacts = await trx
      .selectFrom("contacts")
      .select("id")
      .where("owner_id", "=", owner)
      .where("group_id", "=", id)
      .execute();
    const invites = await trx
      .selectFrom("contact_invites")
      .select("id")
      .where("owner_id", "=", owner)
      .where("group_id", "=", id)
      .execute();
    await trx.updateTable("contacts").set({ group_id: null }).where("owner_id", "=", owner).where("group_id", "=", id).execute();
    await trx
      .updateTable("contacts")
      .set({ asked_group_id: null })
      .where("owner_id", "=", owner)
      .where("asked_group_id", "=", id)
      .execute();
    await trx.updateTable("contact_invites").set({ group_id: null }).where("owner_id", "=", owner).where("group_id", "=", id).execute();
    await trx.deleteFrom("reader_groups").where("owner_id", "=", owner).where("id", "=", id).execute();
    return { ok: true as const, value: { contactIds: contacts.map((c) => c.id), inviteIds: invites.map((i) => i.id) } };
  });
}

/**
 * Puts one person in a group, or in none (`null`). Clears any pending Keep or
 * Move question, because the owner just answered it. False when the person or
 * the group is not this owner's.
 */
export async function setContactGroup(owner: string, contactId: string, groupId: string | null): Promise<boolean> {
  const target = groupId === null ? null : await ownGroupId(owner, groupId);
  if (groupId !== null && !target) return false;
  const { db } = await getDatabase();
  const result = await db
    .updateTable("contacts")
    .set({ group_id: target, asked_group_id: null, updated_at: nowIso() })
    .where("owner_id", "=", owner)
    .where("id", "=", contactId)
    .executeTakeFirst();
  return Number(result.numUpdatedRows) > 0;
}

/**
 * The owner's answer to "asked again through another group's link":
 * `move` puts them in the group the link offered, `keep` leaves them where
 * they are. Either way the question is gone. False when there was no
 * question to answer.
 */
export async function answerAskedGroup(owner: string, contactId: string, answer: "keep" | "move"): Promise<boolean> {
  const { db } = await getDatabase();
  const row = await db
    .selectFrom("contacts")
    .select(["asked_group_id"])
    .where("owner_id", "=", owner)
    .where("id", "=", contactId)
    .executeTakeFirst();
  if (!row?.asked_group_id) return false;
  const move = answer === "move" ? await ownGroupId(owner, row.asked_group_id) : null;
  await db
    .updateTable("contacts")
    .set({ ...(move ? { group_id: move } : {}), asked_group_id: null, updated_at: nowIso() })
    .where("owner_id", "=", owner)
    .where("id", "=", contactId)
    .execute();
  return true;
}

/**
 * Where a link's group lands on the person who used it — the one rule every
 * join follows (`applyLinkGroup`, called from `/j/<code>/step`'s `settle`). A new person, or one with no group yet, simply
 * goes in. Somebody already in *another* group is not moved: the offer waits
 * in `asked_group_id` for the owner, because a link that has been forwarded
 * must never be a way to re-sort the people already reading.
 */
function groupOnJoin(
  offered: string | null,
  existing: { group_id: string | null; asked_group_id: string | null } | null,
): { group_id?: string | null; asked_group_id?: string | null } {
  if (!offered) return {};
  if (!existing || !existing.group_id) return { group_id: offered, asked_group_id: null };
  if (existing.group_id === offered) return { asked_group_id: null };
  return { asked_group_id: offered };
}

/**
 * Applies a link's group to the person who just proved themselves through it,
 * by `groupOnJoin`'s rule. The offered id is re-checked against this owner,
 * so a link whose group was deleted since simply puts nobody anywhere.
 */
export async function applyLinkGroup(owner: string, contactId: string, offered: string | null): Promise<void> {
  const group = await ownGroupId(owner, offered);
  if (!group) return;
  const { db } = await getDatabase();
  const row = await db
    .selectFrom("contacts")
    .select(["group_id", "asked_group_id"])
    .where("owner_id", "=", owner)
    .where("id", "=", contactId)
    .executeTakeFirst();
  if (!row) return;
  const patch = groupOnJoin(group, row);
  if (Object.keys(patch).length === 0) return;
  await db.updateTable("contacts").set(patch).where("owner_id", "=", owner).where("id", "=", contactId).execute();
}

/**
 * Undo for `deleteGroup`: puts exactly the people and links the delete let go
 * of into a group again. Only rows of this owner's, and only ones still in no
 * group — somebody sorted elsewhere in the seconds between is left alone.
 */
export async function restoreGroupMembers(
  owner: string,
  groupId: string,
  members: { contactIds: string[]; inviteIds: string[] },
): Promise<void> {
  const group = await ownGroupId(owner, groupId);
  if (!group) return;
  const { db } = await getDatabase();
  if (members.contactIds.length > 0) {
    await db
      .updateTable("contacts")
      .set({ group_id: group })
      .where("owner_id", "=", owner)
      .where("id", "in", members.contactIds)
      .where("group_id", "is", null)
      .execute();
  }
  if (members.inviteIds.length > 0) {
    await db
      .updateTable("contact_invites")
      .set({ group_id: group })
      .where("owner_id", "=", owner)
      .where("id", "in", members.inviteIds)
      .where("group_id", "is", null)
      .execute();
  }
}
