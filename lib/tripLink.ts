import "server-only";
import crypto from "node:crypto";
import type { Kysely } from "kysely";
import { cache } from "react";
import { cookies } from "next/headers";
import { accessSecret } from "./access";
import { hashSecret } from "./auth";
import { resolveAccess } from "./auth/handshake";
import { isEnabled } from "./capabilities";
import { getContactByEmail } from "./contacts";
import { decryptString, hasContactsKey } from "./contacts/crypto";
import { READ_CODE_RE, readAad } from "./contacts/invites";
import { getDatabase, getDatabaseOrNull, newId, nowIso } from "./db";
import type { Database } from "./db/schema";
import { serverSite } from "./site";
import { getTrip, tripRef } from "./trips";
import type { Trip } from "./types";

/**
 * Trip links — B2961 (epic B2960).
 *
 * `/t/<code>` lets whoever holds the code read **one guest trip**, after one
 * press of a button, at the public reader level: labelled days and photos,
 * drafts and the live line stay closed exactly as for a stranger. It is a
 * second, narrower exception to "a link grants nothing on its own", and it
 * stays narrow by being one branch at the end of `mayReadTrip` and nothing
 * else — `readerLevelFor`, `isGuestOf` and every other gate never learn it.
 *
 * The code is a `contact_invites` row of kind `read` (its own
 * `read_code_hash`). Opening it stores `<inviteId>.<code>` in an HttpOnly
 * cookie; every request re-checks that the row is still live, so Stop on the
 * owner's side ends it on the next request.
 */

const SECURE = process.env.NODE_ENV === "production";
/** `__Host-` needs Secure, Path=/ and no Domain: production only. */
export const LINK_COOKIE = SECURE ? "__Host-fs_link" : "fs_link";
export const LINK_COOKIE_MAX_AGE_S = 400 * 24 * 60 * 60;

export function readLinkUrl(code: string): string {
  return `${serverSite().url.replace(/\/$/, "")}/t/${code}`;
}

export type ReadLink = { owner: string; inviteId: string; trip: Trip };

type ReadRow = {
  id: string;
  owner_id: string;
  trip_id: string | null;
  read_code_hash: string | null;
  revoked_at: string | null;
  expires_at: string | null;
};

/** Live, and for this trip: not stopped, not expired, the trip is still a guest
 * trip, and the instance still has contacts and its key. One meaning of "live"
 * for the page, the press and the gate. */
function liveFor(row: ReadRow | undefined): Trip | null {
  if (!row || row.revoked_at || !row.trip_id) return null;
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return null;
  if (!isEnabled("contacts", row.owner_id) || !hasContactsKey()) return null;
  const trip = getTrip(tripRef(row.owner_id, row.trip_id));
  return trip && trip.visibility === "guest" ? trip : null;
}

/** The live `read` link a code names, with its trip. Null for everything else:
 * unknown, stopped, expired, trip gone, trip not guest, contacts off. */
export async function resolveReadCode(code: string): Promise<ReadLink | null> {
  if (!READ_CODE_RE.test(code)) return null;
  const handle = await getDatabaseOrNull();
  if (!handle) return null;
  const row = await handle.db
    .selectFrom("contact_invites")
    .select(["id", "owner_id", "trip_id", "read_code_hash", "revoked_at", "expires_at"])
    .where("kind", "=", "read")
    .where("read_code_hash", "=", hashSecret(code))
    .executeTakeFirst();
  const trip = liveFor(row);
  return row && trip ? { owner: row.owner_id, inviteId: row.id, trip } : null;
}

/**
 * The CSRF token in the landing page's form. `SameSite=Lax` alone does not stop
 * a cross-site POST in every browser, and `foreignOrigin` lets a missing
 * Origin through, so the press needs more than the cookie attribute.
 *
 * The GET page must write nothing, so the token is stateless: an HMAC of the
 * code and the current hour under `SESSION_SECRET`, valid for this hour and
 * the last. A page that did not render this form cannot produce it; it stops
 * a blind cross-site POST, and the strict Origin check on the press is the
 * other half. ponytail: not bound to the visitor, so someone who can load the
 * page can mint one for themselves — which is all the link already lets them
 * do; bind it to a cookie if the press ever does more.
 */
const HOUR_MS = 60 * 60 * 1000;
function tokenFor(code: string, bucket: number): string {
  return crypto.createHmac("sha256", accessSecret()).update(`trip-link-open:${code}:${bucket}`).digest("hex");
}
export function openToken(code: string): string {
  return tokenFor(code, Math.floor(Date.now() / HOUR_MS));
}
export function openTokenValid(code: string, token: unknown): boolean {
  if (typeof token !== "string" || token.length !== 64) return false;
  const now = Math.floor(Date.now() / HOUR_MS);
  return [now, now - 1].some((b) => {
    const want = Buffer.from(tokenFor(code, b));
    const got = Buffer.from(token);
    return want.length === got.length && crypto.timingSafeEqual(want, got);
  });
}

const COOKIE_VALUE_RE = /^([A-Za-z0-9-]{1,64})\.([^.]{16})$/;

/** The cookie's value for a link — `<inviteId>.<code>`. */
export function linkCookieValue(inviteId: string, code: string): string {
  return `${inviteId}.${code}`;
}

async function cookieOpens(trip: Trip): Promise<boolean> {
  const raw = (await cookies()).get(LINK_COOKIE)?.value;
  const m = raw ? COOKIE_VALUE_RE.exec(raw) : null;
  if (!m || !READ_CODE_RE.test(m[2])) return false;
  const { db } = await getDatabase();
  const row = await db
    .selectFrom("contact_invites")
    .select(["id", "owner_id", "trip_id", "read_code_hash", "revoked_at", "expires_at"])
    .where("owner_id", "=", trip.username)
    .where("id", "=", m[1])
    .where("kind", "=", "read")
    .executeTakeFirst();
  if (!row || row.trip_id !== trip.id || row.read_code_hash !== hashSecret(m[2])) return false;
  return liveFor(row) !== null;
}

/** Someone who kept this trip: a signed-in, unblocked contact with a live keep
 * row through a still-live link. The keep itself is written by the keep door. */
async function keptBy(trip: Trip): Promise<boolean> {
  const { email } = await resolveAccess(trip.username);
  if (!email) return false;
  const contact = await getContactByEmail(trip.username, email);
  if (!contact || contact.status === "blocked") return false;
  const { db } = await getDatabase();
  const row = await db
    .selectFrom("trip_link_keeps")
    .innerJoin("contact_invites", (j) =>
      j
        .onRef("contact_invites.id", "=", "trip_link_keeps.invite_id")
        .onRef("contact_invites.owner_id", "=", "trip_link_keeps.owner_id"),
    )
    .select("trip_link_keeps.id")
    .where("trip_link_keeps.owner_id", "=", trip.username)
    .where("trip_link_keeps.trip_id", "=", trip.id)
    .where("trip_link_keeps.contact_id", "=", contact.id)
    .where("trip_link_keeps.revoked_at", "is", null)
    .where("contact_invites.kind", "=", "read")
    .executeTakeFirst();
  // A keep outlives Stop on purpose (the owner removes keepers separately), so
  // the link's own liveness is not asked; `linkAccess` has checked the trip is
  // still a guest trip.
  return Boolean(row);
}

/**
 * Whether the current request reads this trip through a trip link: `"kept"`
 * for a person who saved it, `"link"` for a browser holding the cookie, null
 * otherwise. Guest trips only — a private trip stays closed whatever any row
 * says. Cached per request: `mayReadTrip` and the media route both ask.
 */
export const linkAccess = cache(async (trip: Trip): Promise<"link" | "kept" | null> => {
  if (trip.visibility !== "guest") return null;
  if (!isEnabled("contacts", trip.username) || !hasContactsKey()) return null;
  if (await keptBy(trip)) return "kept";
  if (await cookieOpens(trip)) return "link";
  return null;
});

/**
 * Records that `contactId` keeps the link's trip: `"kept"` (new, or already
 * kept), `"removed"` when the owner removed this person's keep earlier (nothing
 * is written: only the owner lifts that, so a re-keep must not report success),
 * `"expired"` when the link is no longer live. The invite is read inside the
 * transaction before and again after the insert, so a link stopped between the
 * proof and this write — or during it — keeps nobody. One row per link per
 * person. Writes nothing else — a keep is not a grant.
 *
 * `afterInsert` runs between the insert and the re-read, for the test of that
 * race.
 */
export async function recordKeep(
  link: ReadLink,
  contactId: string,
  afterInsert?: (trx: Kysely<Database>) => Promise<void>,
): Promise<"kept" | "removed" | "expired"> {
  const { db } = await getDatabase();
  const liveInvite = async (trx: Kysely<Database>) =>
    liveFor(
      await trx
        .selectFrom("contact_invites")
        .select(["id", "owner_id", "trip_id", "read_code_hash", "revoked_at", "expires_at"])
        .where("owner_id", "=", link.owner)
        .where("id", "=", link.inviteId)
        .where("kind", "=", "read")
        .executeTakeFirst(),
    ) !== null;
  const ROLLBACK = new Error("link stopped during the keep");
  try {
    return await db.transaction().execute(async (trx) => {
      if (!(await liveInvite(trx))) return "expired";
      const had = await trx
        .selectFrom("trip_link_keeps")
        .select("revoked_at")
        .where("owner_id", "=", link.owner)
        .where("invite_id", "=", link.inviteId)
        .where("contact_id", "=", contactId)
        .executeTakeFirst();
      if (had) return had.revoked_at ? "removed" : "kept";
      await trx
        .insertInto("trip_link_keeps")
        .values({
          id: newId(),
          owner_id: link.owner,
          trip_id: link.trip.id,
          invite_id: link.inviteId,
          contact_id: contactId,
          kept_at: nowIso(),
          revoked_at: null,
        })
        .onConflict((c) => c.columns(["owner_id", "invite_id", "contact_id"]).doNothing())
        .execute();
      await afterInsert?.(trx);
      // Stopped while we wrote: undo the keep (no row lock needed, so it is
      // the same on SQLite and Postgres).
      if (!(await liveInvite(trx))) throw ROLLBACK;
      return "kept";
    });
  } catch (e) {
    if (e === ROLLBACK) return "expired";
    throw e;
  }
}

/** The live link in this browser's cookie, for the keep card on /me: the code
 * is the one the holder already has, and goes nowhere else. Null for no
 * cookie, a stopped or expired link, or a trip no longer shared. */
export async function cookieLink(): Promise<{ code: string; link: ReadLink } | null> {
  const raw = (await cookies()).get(LINK_COOKIE)?.value;
  const m = raw ? COOKIE_VALUE_RE.exec(raw) : null;
  if (!m) return null;
  const link = await resolveReadCode(m[2]);
  return link && link.inviteId === m[1] ? { code: m[2], link } : null;
}

/** Whether this address already has a live keep on the trip. */
export async function keepsTrip(owner: string, tripId: string, email: string): Promise<boolean> {
  const contact = await getContactByEmail(owner, email);
  if (!contact || contact.status === "blocked") return false;
  const { db } = await getDatabase();
  const row = await db
    .selectFrom("trip_link_keeps")
    .select("id")
    .where("owner_id", "=", owner)
    .where("trip_id", "=", tripId)
    .where("contact_id", "=", contact.id)
    .where("revoked_at", "is", null)
    .executeTakeFirst();
  return Boolean(row);
}

/** Every keep that has not been removed, across this owner's links. */
export async function liveKeeps(owner: string) {
  // The Readers page renders without a database too (the file-backed test
  // run); no database means no keeps rather than a crash.
  const handle = await getDatabaseOrNull();
  if (!handle) return [];
  const { db } = handle;
  const rows = await db
    .selectFrom("trip_link_keeps")
    .select(["id", "invite_id", "trip_id", "contact_id"])
    .where("owner_id", "=", owner)
    .where("revoked_at", "is", null)
    .execute();
  return rows.map((r) => ({ id: r.id, inviteId: r.invite_id, tripId: r.trip_id, contactId: r.contact_id }));
}

/** What the Readers page adds to each `read` link (B-2963): the link itself
 * (decrypted for the owner only, never logged), when it was last opened, and
 * who kept it. A null `url` means no copy control. */
export async function readLinkExtras(
  owner: string,
): Promise<Map<string, { url: string | null; lastUsedAt: string | null; keeperIds: string[] }>> {
  const handle = await getDatabaseOrNull();
  if (!handle) return new Map();
  const { db } = handle;
  const rows = await db
    .selectFrom("contact_invites")
    .select(["id", "read_code_cipher", "last_used_at", "revoked_at", "expires_at"])
    .where("owner_id", "=", owner)
    .where("kind", "=", "read")
    .execute();
  const keeps = await liveKeeps(owner);
  return new Map(
    rows.map((r) => {
      const live = !r.revoked_at && !(r.expires_at && new Date(r.expires_at).getTime() < Date.now());
      const code =
        live && r.read_code_cipher ? decryptString(r.read_code_cipher, readAad(owner, r.id), "invite token") : null;
      return [
        r.id,
        {
          url: code ? readLinkUrl(code) : null,
          lastUsedAt: r.last_used_at,
          keeperIds: keeps.filter((k) => k.inviteId === r.id).map((k) => k.contactId),
        },
      ];
    }),
  );
}

/** "Stop it and remove the people who kept it": the link and its keeps end in
 * one transaction. False for an id that is not this owner's `read` link. */
export async function stopLinkAndKeepers(owner: string, inviteId: string): Promise<boolean> {
  const { db } = await getDatabase();
  const now = nowIso();
  return db.transaction().execute(async (trx) => {
    const link = await trx
      .selectFrom("contact_invites")
      .select("id")
      .where("owner_id", "=", owner)
      .where("id", "=", inviteId)
      .where("kind", "=", "read")
      .executeTakeFirst();
    if (!link) return false;
    await trx
      .updateTable("contact_invites")
      .set({ revoked_at: now })
      .where("owner_id", "=", owner)
      .where("id", "=", inviteId)
      .where("revoked_at", "is", null)
      .execute();
    await trx
      .updateTable("trip_link_keeps")
      .set({ revoked_at: now })
      .where("owner_id", "=", owner)
      .where("invite_id", "=", inviteId)
      .where("revoked_at", "is", null)
      .execute();
    return true;
  });
}

/** Remove one keep (the person's "Saved trips" line). False when it is not a
 * live keep of this owner's. */
export async function removeKeep(owner: string, keepId: string): Promise<boolean> {
  const { db } = await getDatabase();
  const done = await db
    .updateTable("trip_link_keeps")
    .set({ revoked_at: nowIso() })
    .where("owner_id", "=", owner)
    .where("id", "=", keepId)
    .where("revoked_at", "is", null)
    .executeTakeFirst();
  return Number(done.numUpdatedRows ?? 0) > 0;
}
