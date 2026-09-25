import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { mayMailContact } from "@/lib/contacts/mail";

/**
 * Nothing enforces that a mail only ever goes to a confirmed address — B334.
 *
 * `mayMailContact` (`lib/contacts/mail.ts`) is the one gate every
 * contact-addressed sender now routes through. This has two halves, because
 * either alone would be the same folklore B334 found: a unit test of the
 * function proves the rule itself is right, and a source scan over the two
 * files that address a contact (`lib/contacts/mail.ts`, the five letters, and
 * `lib/digest/dayLetter.ts`'s recipient loop) proves every *sender* actually
 * calls it — which is the half that catches a **future** sender someone adds
 * without reading this file, the failure this ticket exists to prevent.
 */

describe("mayMailContact", () => {
  test("refuses an address with no confirmed_at", () => {
    expect(mayMailContact({ email: "nobody@example.test", confirmedAt: null })).toBe(false);
  });

  test("allows an address that has confirmed", () => {
    expect(
      mayMailContact({ email: "somebody@example.test", confirmedAt: "2026-01-01T00:00:00Z" }),
    ).toBe(true);
  });

  test("the named opt-out reaches an unconfirmed address anyway", () => {
    expect(
      mayMailContact({ email: "nobody@example.test", confirmedAt: null }, { allowUnconfirmed: true }),
    ).toBe(true);
  });

  /**
   * The literal shape the acceptance line asks for: a sender that mails an
   * unconfirmed contact without opting out is refused, and this test fails if
   * the check inside `mayMailContact` is removed or weakened.
   */
  test("a hypothetical sixth sender that forgets to opt out is refused", () => {
    function sendSomeNewMail(contact: { email: string; confirmedAt: string | null }) {
      if (!mayMailContact(contact)) return null;
      return "sent" as const;
    }
    expect(sendSomeNewMail({ email: "new@example.test", confirmedAt: null })).toBeNull();
  });
});

/**
 * The enumeration half. Every function in these two files that calls
 * `sendMail(` must also call `mayMailContact(` somewhere in its own body,
 * unless it is named in `OWNER_MAIL` — mail addressed to `config.json`'s own
 * `owner.email` rather than to a contact, which is a different question
 * (`notifyOwnerOfRequest`'s own comment says so). A function added later that
 * calls `sendMail(` and is not on that list has to call the gate or this
 * fails — that is the whole point.
 */
const FILES = ["lib/contacts/mail.ts", "lib/digest/dayLetter.ts"];
const OWNER_MAIL = new Set(["notifyOwnerOfRequest"]);

/** Crude but sufficient: split on top-level `function` declarations and walk
 * brace depth to find each one's own body, the same shape
 * `test/no-browser-dialogs.test.ts` uses for its own source scan. */
function functionBodies(source: string): { name: string; body: string }[] {
  const out: { name: string; body: string }[] = [];
  const re = /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) {
    const openParen = re.lastIndex - 1;
    // Find the `{` that opens the body, after the parameter list closes.
    let depth = 0;
    let i = openParen;
    for (; i < source.length; i++) {
      if (source[i] === "(") depth++;
      else if (source[i] === ")") {
        depth--;
        if (depth === 0) break;
      }
    }
    const braceStart = source.indexOf("{", i);
    if (braceStart === -1) continue;
    let braceDepth = 0;
    let j = braceStart;
    for (; j < source.length; j++) {
      if (source[j] === "{") braceDepth++;
      else if (source[j] === "}") {
        braceDepth--;
        if (braceDepth === 0) break;
      }
    }
    out.push({ name: match[1], body: source.slice(braceStart, j + 1) });
  }
  return out;
}

/**
 * Whether `fn` is gated, directly or by calling a same-file helper that is —
 * one level deep, which is exactly `sendDayLetter` calling `recipientsFor`:
 * the gate runs while the recipient list is built, not at the `sendMail(`
 * call site itself, since by then the list has already been filtered.
 */
function isGated(fn: { name: string; body: string }, byName: Map<string, string>): boolean {
  if (fn.body.includes("mayMailContact(")) return true;
  for (const [name, body] of byName) {
    if (name === fn.name) continue;
    if (fn.body.includes(`${name}(`) && body.includes("mayMailContact(")) return true;
  }
  return false;
}

describe("every contact-addressed sender calls the gate", () => {
  for (const rel of FILES) {
    test(rel, () => {
      const source = fs.readFileSync(path.join(process.cwd(), rel), "utf8");
      const fns = functionBodies(source);
      const byName = new Map(fns.map((fn) => [fn.name, fn.body]));
      const offenders = fns
        .filter((fn) => fn.body.includes("sendMail("))
        .filter((fn) => !OWNER_MAIL.has(fn.name))
        .filter((fn) => !isGated(fn, byName))
        .map((fn) => fn.name);
      expect(offenders).toEqual([]);
    });
  }
});
