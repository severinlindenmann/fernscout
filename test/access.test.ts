import { describe, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import {
  hashTripPassword,
  isIndexable,
  isOpenToLink,
  maySeeCosts,
  signTripToken,
  verifyTripPassword,
  verifyTripToken,
} from "@/lib/access";
import type { Trip } from "@/lib/types";

function trip(over: Partial<Trip> = {}): Trip {
  return {
    id: "t",
    username: "u",
    ref: "u/t",
    title: "T",
    start: "2026-01-01",
    end: "2026-01-05",
    status: "past",
    people: [],
    listed: true,
    accent: "sky",
    rates: {},
    intro: "",
    visibility: "public",
    costsVisibility: "public",
    ...over,
  };
}

describe("password hashing", () => {
  test("a password verifies against its own hash", () => {
    const stored = hashTripPassword("correct horse");
    expect(verifyTripPassword("correct horse", stored)).toBe(true);
  });

  test("a wrong password does not", () => {
    const stored = hashTripPassword("correct horse");
    expect(verifyTripPassword("Correct horse", stored)).toBe(false);
    expect(verifyTripPassword("", stored)).toBe(false);
  });

  test("two hashes of the same password differ (salted)", () => {
    expect(hashTripPassword("same")).not.toBe(hashTripPassword("same"));
  });

  test("a malformed stored hash is rejected, not crashed on", () => {
    for (const bad of ["", "nonsense", "scrypt$x$y$z$a$b", "bcrypt$1$2$3$4$5"]) {
      expect(verifyTripPassword("anything", bad)).toBe(false);
    }
  });

  test("unicode passwords normalise consistently", () => {
    const stored = hashTripPassword("Ferienüber");
    expect(verifyTripPassword("Ferienüber", stored)).toBe(true);
  });

  /** The CLI duplicates the hash format by necessity — it is plain node, not
   * TypeScript. If the two ever drift, this fails. */
  test("a hash from scripts/trip-password.mjs verifies in lib/access.ts", () => {
    const out = execFileSync("node", ["scripts/trip-password.mjs", "a real password"], {
      encoding: "utf8",
    }).trim();
    expect(verifyTripPassword("a real password", out)).toBe(true);
    expect(verifyTripPassword("wrong", out)).toBe(false);
  });
});

describe("access cookies", () => {
  const secret = "test-secret";
  const protectedTrip = trip({ visibility: "guest", passwordHash: "hash-v1" });

  test("a freshly signed token verifies", () => {
    process.env.SESSION_SECRET = secret;
    expect(verifyTripToken(protectedTrip, signTripToken(protectedTrip))).toBe(true);
    delete process.env.SESSION_SECRET;
  });

  test("a tampered token does not", () => {
    process.env.SESSION_SECRET = secret;
    const token = signTripToken(protectedTrip);
    expect(verifyTripToken(protectedTrip, token.replace(/.$/, "x"))).toBe(false);
    expect(verifyTripToken(protectedTrip, "")).toBe(false);
    expect(verifyTripToken(protectedTrip, undefined)).toBe(false);
    delete process.env.SESSION_SECRET;
  });

  test("changing the password invalidates tokens already issued", () => {
    process.env.SESSION_SECRET = secret;
    const token = signTripToken(protectedTrip);
    const rotated = trip({ visibility: "guest", passwordHash: "hash-v2" });
    expect(verifyTripToken(rotated, token)).toBe(false);
    delete process.env.SESSION_SECRET;
  });

  test("a token from another trip does not work here", () => {
    process.env.SESSION_SECRET = secret;
    const other = trip({ id: "other", ref: "u/other", visibility: "guest", passwordHash: "hash-v1" });
    expect(verifyTripToken(protectedTrip, signTripToken(other))).toBe(false);
    delete process.env.SESSION_SECRET;
  });

  test("signing without a secret fails loudly", () => {
    delete process.env.SESSION_SECRET;
    expect(() => signTripToken(protectedTrip)).toThrow(/SESSION_SECRET/);
  });
});

describe("visibility predicates", () => {
  test("a public, listed trip is indexable and nothing else is", () => {
    expect(isIndexable(trip({ visibility: "public", listed: true }))).toBe(true);
    // The old `unlisted`: public, but not advertised.
    expect(isIndexable(trip({ visibility: "public", listed: false }))).toBe(false);
    expect(isIndexable(trip({ visibility: "guest", listed: false }))).toBe(false);
    expect(isIndexable(trip({ visibility: "private", listed: false }))).toBe(false);
  });

  test("only a public trip opens to a bare link", () => {
    expect(isOpenToLink(trip({ visibility: "public", listed: true }))).toBe(true);
    expect(isOpenToLink(trip({ visibility: "public", listed: false }))).toBe(true);
    expect(isOpenToLink(trip({ visibility: "guest" }))).toBe(false);
    expect(isOpenToLink(trip({ visibility: "private" }))).toBe(false);
  });

  test("guests-only costs need a guest", () => {
    expect(maySeeCosts(trip({ costsVisibility: "guests" }), false)).toBe(false);
    expect(maySeeCosts(trip({ costsVisibility: "guests" }), true)).toBe(true);
    expect(maySeeCosts(trip({ costsVisibility: "public" }), false)).toBe(true);
  });
});

/**
 * A trip protected after the server started.
 *
 * `instrumentation.ts` checks at boot that a password-protected trip has a
 * `SESSION_SECRET` to sign with — but that is a snapshot, and content here is
 * markdown a person edits. Adding `passwordHash:` to a trip on a running
 * server produced a trip the process could not serve: `verifyTripToken` threw,
 * it is called from `mayReadTrip`, and so every page under that trip became a
 * blank 500 while the operator got the same stack trace a few hundred times.
 *
 * Failing closed is both the safe answer and the useful one: the reader sees
 * the gate, and the log says what to do, once.
 */
describe("a password-protected trip with no signing secret", () => {
  const guarded = trip({
    visibility: "guest",
    passwordHash: "scrypt$32768$8$1$c2FsdA$aGFzaA",
  });

  test("refuses every cookie rather than throwing", () => {
    const saved = process.env.SESSION_SECRET;
    delete process.env.SESSION_SECRET;
    try {
      expect(() => verifyTripToken(guarded, "anything.atall")).not.toThrow();
      expect(verifyTripToken(guarded, "anything.atall")).toBe(false);
    } finally {
      if (saved === undefined) delete process.env.SESSION_SECRET;
      else process.env.SESSION_SECRET = saved;
    }
  });

  test("and a cookie that was valid before the secret went missing stops working", () => {
    process.env.SESSION_SECRET = "a".repeat(64);
    const token = signTripToken(guarded);
    expect(verifyTripToken(guarded, token)).toBe(true);

    delete process.env.SESSION_SECRET;
    expect(verifyTripToken(guarded, token)).toBe(false);
  });
});
