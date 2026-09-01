import { beforeEach, describe, expect, test } from "vitest";
import {
  CONFIRM_TTL_MS,
  confirmationMatches,
  confirmationRequired,
  issueConfirmation,
  type Operation,
} from "@/lib/agentConfirm";

/**
 * The gate in front of anything that cannot be undone.
 *
 * The point of a server-issued code, rather than an `"are_you_sure": true`
 * flag, is that an agent cannot produce one — and that a code obtained for one
 * operation does not authorise a different one. Both of those are what these
 * tests are actually about; the expiry is the easy part.
 *
 * This file is also the only thing standing over `accessSecret()` in
 * `lib/access.ts`. That function looks like trip-password machinery — it is
 * named for the file it was born in, where it signed the password cookie — and
 * B39 deleted everything around it. It stayed because `sign()` below signs
 * every confirmation code with it, up to and including a journal deletion.
 * Nothing here mocks it: these tests set `SESSION_SECRET` and run the real
 * HMAC, so removing the function fails this file rather than shipping an agent
 * that cannot confirm anything.
 */

const deleteDay: Operation = {
  action: "delete_draft",
  scope: "alex/asia-2026",
  target: "lanterns-of-hoi-an",
};

beforeEach(() => {
  process.env.SESSION_SECRET = "test-secret-for-confirmations";
});

describe("a confirmation code", () => {
  test("authorises the operation it was issued for", () => {
    expect(confirmationMatches(issueConfirmation(deleteDay), deleteDay)).toBe(true);
  });

  /** The property that makes this worth more than a boolean flag. */
  test.each([
    [{ ...deleteDay, target: "a-different-day" }, "another day"],
    [{ ...deleteDay, scope: "alex/other-trip" }, "another trip"],
    [{ ...deleteDay, scope: "bea/asia-2026" }, "another journal"],
    [{ ...deleteDay, action: "delete_media" as const }, "another verb"],
    // The one that matters most: tidying away an unpublished scrap must not
    // become removing a day somebody's family has already read.
    [{ ...deleteDay, action: "delete_published" as const }, "the published verb"],
  ])("does not authorise %#: %s", (other) => {
    expect(confirmationMatches(issueConfirmation(deleteDay), other)).toBe(false);
  });

  test("expires", () => {
    const now = Date.now();
    const code = issueConfirmation(deleteDay, now);
    expect(confirmationMatches(code, deleteDay, now + CONFIRM_TTL_MS - 1000)).toBe(true);
    expect(confirmationMatches(code, deleteDay, now + CONFIRM_TTL_MS + 1000)).toBe(false);
  });

  test("a code from the future is refused too", () => {
    const now = Date.now();
    expect(confirmationMatches(issueConfirmation(deleteDay, now + 60_000), deleteDay, now)).toBe(false);
  });

  /** An agent cannot mint one: it does not hold SESSION_SECRET. */
  test.each([
    ["", "nothing"],
    ["cf_yes_please", "a guess"],
    ["yes", "a bare word"],
    ["cf_", "a prefix alone"],
  ])("refuses %s (%s)", (code) => {
    expect(confirmationMatches(code, deleteDay)).toBe(false);
  });

  test("a code signed with a different secret does not verify", () => {
    const code = issueConfirmation(deleteDay);
    process.env.SESSION_SECRET = "somebody-else's-secret";
    expect(confirmationMatches(code, deleteDay)).toBe(false);
  });
});

describe("what the agent is told", () => {
  test("carries a usable code and asks the question it should have asked", () => {
    const body = confirmationRequired(deleteDay, "This permanently deletes the day.");
    expect(body.error).toBe("confirmation_required");
    expect(confirmationMatches(body.confirm, deleteDay)).toBe(true);
    expect(body.message).toContain("Did the person actually ask you to?");
    // It has to name the field to repeat, or the agent has to guess.
    expect(body.message).toContain('"confirm"');
  });
});

/**
 * The signature is base64url, whose alphabet includes `_` — the same
 * character that separates the code's three parts. A plain `split("_")`
 * truncated the MAC at the first one, so roughly a third of all codes failed
 * to verify and the rest passed. A single round trip is not enough to catch
 * that; this runs enough of them to be sure.
 */
describe("codes whose signature contains a separator", () => {
  test("every code verifies, not just the ones without an underscore", () => {
    let withUnderscore = 0;
    for (let i = 0; i < 200; i++) {
      const operation: Operation = { ...deleteDay, target: `day-${i}` };
      const code = issueConfirmation(operation);
      if (code.split("_").length > 3) withUnderscore += 1;
      expect(confirmationMatches(code, operation), code).toBe(true);
    }
    // If this ever hits zero the test has stopped covering the case.
    expect(withUnderscore).toBeGreaterThan(0);
  });
});
