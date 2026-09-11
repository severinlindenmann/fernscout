import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import en from "@/site/locales/en.json";

/**
 * A refusal nobody wrote a sentence for — B948.
 *
 * `failureSentence()` in `components/HelperAsk.tsx` turns a route's error code
 * into something a person can read, and falls back to printing the code when
 * it does not recognise one. `invalid_trip` was not on the list, so clearing
 * the title on a trip proposal and pressing put
 *
 *     That did not work: invalid_trip.
 *
 * on the screen — and into a focused `role="alert"`, which a blind reader
 * hears immediately and at full volume: an internal identifier, read aloud as
 * though it were a sentence. Five codes had sentences; the routes could return
 * twenty-two.
 *
 * The fallback is not the fault and stays: a code is better than silence. What
 * was missing is anything that notices. This reads the routes themselves, so a
 * refusal added next month fails here rather than on somebody's screen.
 */

const ROUTES = [
  "trip",
  "trip/visibility",
  "trip/people",
  "trip/tracks",
  "day",
  "day/publish",
  "day/unpublish",
  "day/attach",
  "day/costs",
  "day/write-day",
  "invite",
  "postcard",
];

/** Every `error: "…"` a helper write route can answer with. */
function refusalsOf(route: string): string[] {
  const file = path.join(process.cwd(), "app/api/helper/[user]", route, "route.ts");
  const source = fs.readFileSync(file, "utf-8");
  return [...source.matchAll(/error:\s*"([a-z_]+)"/g)].map((found) => found[1]);
}

const named = new Set(
  [...fs.readFileSync(path.join(process.cwd(), "components/HelperAsk.tsx"), "utf-8")
    .matchAll(/^\s{2}"([a-z_]+)",$/gm)].map((found) => found[1]),
);

describe("every refusal a press can meet", () => {
  for (const route of ROUTES) {
    for (const code of new Set(refusalsOf(route))) {
      test(`${route} → ${code} has a sentence of its own`, () => {
        expect(named, `add "${code}" to NAMED_FAILURES in components/HelperAsk.tsx`).toContain(code);
        expect(
          (en as Record<string, string>)[`agent.error.${code}`],
          `add "agent.error.${code}" to site/locales/*.json`,
        ).toBeTruthy();
      });
    }
  }

  test("and no sentence is written for a refusal that cannot happen", () => {
    const reachable = new Set(ROUTES.flatMap(refusalsOf));
    const spare = [...named].filter((code) => !reachable.has(code));
    // `no_day_on_date` and friends may come from a shared helper rather than
    // the route file, so this reports rather than fails — the point is to
    // notice a sentence outliving the refusal it was written for.
    if (spare.length > 0) console.warn(`helper: sentences with no refusal behind them — ${spare.join(", ")}`);
    expect(named.size).toBeGreaterThanOrEqual(reachable.size);
  });
});
