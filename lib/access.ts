import "server-only";
import type { Trip } from "./types";

/**
 * Reading rights for a trip, as far as the trip's own frontmatter decides them.
 *
 * This file used to hold a shared-password scheme: a scrypt hash in the trip's
 * frontmatter, a signed cookie, and an unlock form. B39 removed all of it. One
 * secret held by everybody who was ever sent it cannot be revoked for one
 * person, is forwarded without the owner knowing, and asks the reader this is
 * written for — family who open the site once a month from a link — to keep
 * something they will lose.
 *
 * What replaced it is not in this file at all: a reader proves an address by
 * e-mail (`/api/auth/request`) and the owner's grant decides what that address
 * may read (`lib/grants.ts`, `lib/contacts/session.ts`). **The mail proves who
 * you are; the grant decides what you may read.** Signing in on its own opens
 * nothing, which is the property `lib/tripGate.ts` depends on.
 *
 * So what is left here is the part that needs no session: predicates over a
 * trip's own `visibility`.
 */

/**
 * The HMAC key for things the server signs for itself.
 *
 * Named for the file it was born in — it signed the trip-password cookie — and
 * its only caller now is `lib/agentConfirm.ts`, which signs the confirmation
 * code an agent must repeat back before a destructive operation. It stayed
 * when the passwords went, because deleting it with them would have broken
 * every agent confirmation, including a journal deletion, with no test failing
 * to say so.
 */
export function accessSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error(
      "SESSION_SECRET is not set, so nothing can be signed. " +
        "Generate one with `openssl rand -hex 32`.",
    );
  }
  return secret;
}

/**
 * Trips that may be listed, linked from a sitemap, or indexed.
 *
 * A `test` trip never is, whatever its visibility says. It exists to prove the
 * software works end to end, and the one place that must never happen is
 * somebody's feed reader — a fabricated Tuesday arriving beside real ones is
 * the exact harm the draft rule exists to prevent, wearing a different hat.
 * Reachable by its URL, and there it wears a banner.
 */
export function isIndexable(trip: Trip): boolean {
  return trip.visibility === "public" && trip.listed && !trip.test;
}

/**
 * Whether this is content nobody lived: the trip is marked `test`, or this
 * particular day is.
 *
 * A trip's flag covers its days, so somebody exercising the pipeline sets it
 * once. An entry may also carry its own inside an otherwise real trip, which
 * is what an agent asked to demonstrate the write path in a journal that is
 * already in use should do.
 */
export function isTestContent(trip: Trip | undefined, entry?: { test?: boolean }): boolean {
  return trip?.test === true || entry?.test === true;
}

/** Trips reachable by anyone holding the link, with no secret. */
export function isOpenToLink(trip: Trip): boolean {
  return trip.visibility === "public";
}

/** Whether costs may be rendered for this viewer. */
export function maySeeCosts(trip: Trip, isGuest: boolean): boolean {
  return trip.costsVisibility === "public" || isGuest;
}
