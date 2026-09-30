import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { callCostRappen } from "@/lib/usage";

/**
 * Every metered call carries an owner — B2589.
 *
 * `book()` (lib/helper/model.ts) used to return silently when no owner was
 * passed, so a call site with a bug simply vanished from the bill with no
 * trace. The fix is at the type level — `book`'s own `owner` parameter is
 * `string`, not `string | undefined` — but a type only catches a call
 * written *after* the fix; this test is what catches a call rewritten to
 * quietly drop the fallback later. It reads the source rather than a
 * hand-typed list of function names, so a new call site is covered the
 * moment it is added, same as the type is.
 */
function read(relative: string): string {
  return fs.readFileSync(path.join(process.cwd(), relative), "utf8");
}

describe("every call into book() carries an owner", () => {
  test("lib/helper/model.ts: every await book(...) argument is a required string or an explicit NO_JOURNAL fallback", () => {
    const src = read("lib/helper/model.ts");
    const calls = [...src.matchAll(/await book\(\s*([^,]+),/g)].map((m) => m[1].trim());
    // Guards against the regex itself silently matching nothing — a rewrite
    // that renamed `book` would make every call below vacuously pass.
    expect(calls.length).toBeGreaterThanOrEqual(9);
    for (const arg of calls) {
      const isRequiredLocal = arg === "username"; // answerInThread's own param, never optional
      const fallsBackExplicitly = /\?\?\s*NO_JOURNAL$/.test(arg);
      expect(isRequiredLocal || fallsBackExplicitly, `book(${arg}, ...) has no guaranteed owner`).toBe(
        true,
      );
    }
  });

  test("lib/helper/transcribe.ts: every recordUsage({ owner: ... }) call falls back to NO_JOURNAL", () => {
    const src = read("lib/helper/transcribe.ts");
    const calls = [...src.matchAll(/recordUsage\(\{([\s\S]*?)\}\);/g)].map((m) => m[1]);
    expect(calls.length).toBeGreaterThanOrEqual(1);
    for (const body of calls) {
      const owner = /owner:\s*([^,\n]+),/.exec(body)?.[1]?.trim();
      expect(owner, `a recordUsage call with no owner: field at all`).toBeDefined();
      expect(
        owner === "record.owner" || /\?\?\s*NO_JOURNAL$/.test(owner ?? ""),
        `owner: ${owner} has no guaranteed fallback`,
      ).toBe(true);
    }
  });
});

describe("callCostRappen — the price frozen at write time", () => {
  test("a model this instance's config has no price for returns null, never a guessed zero", () => {
    expect(
      callCostRappen({ owner: "alex", provider: "anthropic", model: "no-such-model", operation: "write_day" }),
    ).toBeNull();
  });

  test("an explicit costRappen is stored as given, whatever the provider", () => {
    expect(
      callCostRappen({ owner: "alex", provider: "twilio", model: "sms", operation: "sms_send", costRappen: 12.4 }),
    ).toBe(12);
  });
});
