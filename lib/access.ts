import "server-only";
import crypto from "node:crypto";
import type { Trip } from "./types";

/**
 * Reading rights for a trip.
 *
 * Deliberately has no database behind it. A shared password is a hash in the
 * trip's own frontmatter and a signed cookie, which means the cheapest useful
 * privacy control in the project works in the no-database deployment too.
 *
 * Identified, per-person access arrives later and layers on top: this module
 * answers "may this request read this trip", and gains a second source of yes.
 */

const SCRYPT_N = 1 << 15; // ~32 MB of memory per verification
const SCRYPT_r = 8;
const SCRYPT_p = 1;
const KEY_LEN = 32;

/**
 * scrypt rather than argon2id.
 *
 * argon2id is the better primitive, but every Node binding for it is a native
 * module — a compiler on every self-hoster's machine, and a build that breaks
 * on Alpine. scrypt is memory-hard, in the standard library, and entirely
 * adequate for a shared family password that is also rate-limited.
 */
export function hashTripPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password.normalize("NFKC"), salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_r,
    p: SCRYPT_p,
    maxmem: 128 * SCRYPT_N * SCRYPT_r * 2,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_r}$${SCRYPT_p}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export function verifyTripPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, keyB64] = parts;
  const N = Number(n);
  const rr = Number(r);
  const pp = Number(p);
  if (!Number.isFinite(N) || !Number.isFinite(rr) || !Number.isFinite(pp)) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltB64, "base64url");
    expected = Buffer.from(keyB64, "base64url");
  } catch {
    return false;
  }

  let actual: Buffer;
  try {
    actual = crypto.scryptSync(password.normalize("NFKC"), salt, expected.length, {
      N,
      r: rr,
      p: pp,
      maxmem: 128 * N * rr * 2,
    });
  } catch {
    return false;
  }
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

/** Trips whose password gate is in use need something to sign cookies with. */
export function accessSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error(
      "SESSION_SECRET is not set, but a trip is password-protected. " +
        "Generate one with `openssl rand -hex 32`.",
    );
  }
  return secret;
}

/**
 * Said once per process, not once per request.
 *
 * The boot check in `instrumentation.ts` catches the ordinary case, but it is
 * a snapshot: content here is markdown a person edits, and adding
 * `passwordHash:` to a trip on a running server produces a trip the process
 * cannot serve. Every render of every page under it then threw, so the reader
 * got a blank 500 and the operator got the same stack trace a few hundred
 * times with the useful sentence buried in it.
 */
let secretWarned = false;

function missingSecret(): boolean {
  if (process.env.SESSION_SECRET) return false;
  if (!secretWarned) {
    secretWarned = true;
    console.error(
      "[access] A trip is password-protected but SESSION_SECRET is not set, so nobody " +
        "can be let in. The trip is locked rather than served. Generate one with " +
        "`openssl rand -hex 32` and restart.",
    );
  }
  return true;
}

export function tripCookieName(ref: string): string {
  // The qualified ref, because trip ids are unique per user and not across the
  // instance: two journals may each have an "alps-2024", and a cookie named
  // for the bare id would have them overwrite each other's access.
  return `fs_trip_${ref.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

/** Cookie lifetime. Long on purpose: a reader should enter the password once. */
export const TRIP_COOKIE_MAX_AGE = 60 * 60 * 24 * 90;

/**
 * A cookie value proving the password was entered.
 *
 * Bound to the trip *and* to its current password hash, so changing the
 * password immediately invalidates every cookie already issued — which is the
 * only revocation mechanism a passwords-only scheme has. The trip is named by
 * its qualified ref: ids repeat across journals, and a signature over the bare
 * id would be one collision away from meaning the wrong trip.
 */
export function signTripToken(trip: Trip): string {
  const issued = Date.now().toString(36);
  const mac = crypto
    .createHmac("sha256", accessSecret())
    .update(`${trip.ref}.${trip.passwordHash ?? ""}.${issued}`)
    .digest("base64url");
  return `${issued}.${mac}`;
}

export function verifyTripToken(trip: Trip, token: string | undefined): boolean {
  if (!token) return false;
  // No secret, no valid cookie — which is the honest answer and the safe one.
  // This used to throw, and it is called from `mayReadTrip`, so a trip that
  // was password-protected after the process started turned every page under
  // it into a 500. A 500 tells the reader nothing and hides the trip's content
  // by accident; the gate hides it on purpose and says what to do.
  if (missingSecret()) return false;
  const [issued, mac] = token.split(".");
  if (!issued || !mac) return false;

  const age = Date.now() - parseInt(issued, 36);
  if (!Number.isFinite(age) || age < 0 || age > TRIP_COOKIE_MAX_AGE * 1000) return false;

  const expected = crypto
    .createHmac("sha256", accessSecret())
    .update(`${trip.ref}.${trip.passwordHash ?? ""}.${issued}`)
    .digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
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

/** A trip whose gate a password can open. Everything but `public`. */
export function isRestricted(trip: Trip): boolean {
  return trip.visibility !== "public";
}

/** Whether costs may be rendered for this viewer. */
export function maySeeCosts(trip: Trip, isGuest: boolean): boolean {
  return trip.costsVisibility === "public" || isGuest;
}

/**
 * Fails the boot when a trip is password-protected but nothing can sign the
 * cookie that remembers it. Without this the gate throws on first use — in
 * front of a reader, rather than in front of whoever deployed it.
 */
export function assertTripAccessConfig(trips: Trip[]): void {
  const protectedTrips = trips.filter((t) => t.visibility === "guest" && t.passwordHash);
  if (protectedTrips.length === 0) return;

  const missingHash = protectedTrips.filter((t) => !t.passwordHash).map((t) => t.id);
  if (missingHash.length > 0) {
    throw new Error(
      `These trips declare visibility: guest but have no passwordHash: ` +
        `${missingHash.join(", ")}. Generate one with \`npm run trip:password\`.`,
    );
  }
  if (!process.env.SESSION_SECRET) {
    throw new Error(
      `${protectedTrips.length} trip(s) are password-protected, but SESSION_SECRET is not set. ` +
        `Generate one with \`openssl rand -hex 32\`.`,
    );
  }
}
