import "server-only";
import { isEnabled } from "../capabilities";
import { getDatabase } from "../db";
import { translateIn } from "../locales";
import type { Locale } from "../types";
import { createGroup, listGroups } from "./groups";
import { hasContactsKey } from "./crypto";
import { createInvite, revokeInvite } from "./invites";
import { joinCodeFor, joinUrl } from "./welcome";

/**
 * "Ask to read along" — B2665 round 2. A standing, journal-wide invite
 * link (one `contact_invites` row of kind `guest`, deterministic id
 * `story-<owner>` — the table's id column is a free-form primary key, so
 * this needs no lookup-by-name) that the owner turns on from the share
 * screen rather than issuing from Readers. Holding it is still not access:
 * the `/j/<code>` flow it resolves through is the same request-and-approve
 * door every other guest link uses.
 */

function storyInviteId(owner: string): string {
  return `story-${owner}`;
}

/** The locale string naming the group new story requests land in. */
const GROUP_NAME_KEY = "studio.share.readAlong.groupName" as const;

export type StoryLinkState =
  | { status: "unavailable" }
  | { status: "none" }
  | { status: "live"; url: string; inviteId: string }
  | { status: "paused"; inviteId: string };

/** Whether the feature exists for this journal at all — never "broken", only
 * absent when contacts are off or the link cannot later be read back. */
function available(owner: string): boolean {
  return isEnabled("contacts", owner) && hasContactsKey();
}

async function findStoryInvite(owner: string): Promise<{ id: string; revokedAt: string | null } | null> {
  const { db } = await getDatabase();
  const row = await db
    .selectFrom("contact_invites")
    .select(["id", "revoked_at"])
    .where("owner_id", "=", owner)
    .where("id", "=", storyInviteId(owner))
    .executeTakeFirst();
  return row ? { id: row.id, revokedAt: row.revoked_at } : null;
}

export async function storyLinkState(owner: string): Promise<StoryLinkState> {
  if (!available(owner)) return { status: "unavailable" };
  const row = await findStoryInvite(owner);
  if (!row) return { status: "none" };
  if (row.revokedAt) return { status: "paused", inviteId: row.id };
  const code = await joinCodeFor(owner, row.id);
  if (!code) return { status: "paused", inviteId: row.id }; // link lost — same as paused, nothing to show
  return { status: "live", url: joinUrl(code), inviteId: row.id };
}

/**
 * A reader group named by locale, reused if a group already carries that
 * exact name (owner-created or from an earlier call that hit the limit
 * without one). `null` when none could be made or found — the invite is
 * still created, with no group.
 */
async function ensureStoryGroup(owner: string, locale: Locale): Promise<string | null> {
  const name = translateIn(locale, GROUP_NAME_KEY);
  const existing = await listGroups(owner);
  const match = existing.find((g) => g.name.toLowerCase() === name.toLowerCase());
  if (match) return match.id;
  const created = await createGroup(owner, { name });
  return created.ok ? created.value.id : null;
}

/**
 * Only on an explicit owner action (the share screen's "Turn it on").
 * Idempotent: a second call on an existing row changes nothing and returns
 * its current state — it never un-pauses a paused link.
 */
export async function ensureStoryLink(owner: string, locale: Locale): Promise<StoryLinkState> {
  if (!available(owner)) return { status: "unavailable" };
  const existing = await findStoryInvite(owner);
  if (existing) return storyLinkState(owner);
  const groupId = await ensureStoryGroup(owner, locale);
  await createInvite(owner, {
    kind: "guest",
    id: storyInviteId(owner),
    locale,
    groupId,
    // No email, no expiry: never pre-approved, never dies on a clock.
  });
  return storyLinkState(owner);
}

/** Pause — revokes the row. Reversible: the same `/j/` code works again on
 * resume. */
export async function pauseStoryLink(owner: string): Promise<void> {
  await revokeInvite(owner, storyInviteId(owner));
}

/**
 * Resume — an explicit owner action only, never automatic. Clears
 * `revoked_at` on the same row so already-posted stories keep working.
 *
 * Deliberately small and general (any invite's id, not just the story
 * link's own) because `revokeInvite` in `./invites` already is — this is
 * its missing other half, kept here rather than there only because nothing
 * but the story link resumes a link today.
 */
async function resumeInvite(owner: string, id: string): Promise<void> {
  const { db } = await getDatabase();
  await db
    .updateTable("contact_invites")
    .set({ revoked_at: null })
    .where("owner_id", "=", owner)
    .where("id", "=", id)
    .execute();
}

export async function resumeStoryLink(owner: string): Promise<StoryLinkState> {
  await resumeInvite(owner, storyInviteId(owner));
  return storyLinkState(owner);
}

