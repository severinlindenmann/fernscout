import { describe, expect, test } from "vitest";
import { TOOLS } from "@/lib/helper/tools";

/**
 * A card that hides its subject must say it — B1107.
 *
 * B1122 made a server-resolved field `fixed`, and the renderer draws nothing
 * at all for one: a person never typed `iceland-2026` and must not be asked to
 * correct it. That is right, and it takes something away — the card used to
 * name the trip, badly, in a box.
 *
 * So the sentence has to name it instead, and two did not. `set_rate` read
 * *"1 THB = 0.011 CHF."* and `set_budget` read *"A budget of 500 over 5
 * days."* — neither naming a trip nor a day, on an owner who may have several
 * trips, about money. Hiding the field there would have left the card
 * identifying nothing whatsoever.
 *
 * This is the guard for the next one. Every write tool that carries a hidden
 * `trip` or `slug` must put a `{trip}`, `{date}` or `{title}` placeholder in
 * its own sentence — a day names the day, and a trip-scoped write names the
 * trip.
 *
 * **Why the placeholder and not the rendered sentence.** `say()` here would
 * need a journal, a trip and a day on disk to render anything, and this test
 * would then be about the fixture rather than about the rule. The placeholder
 * is the promise; `test/helper-money.test.ts` and the persona runs are what
 * check the promise is kept.
 */

/** The keys whose value the person never typed and never sees. */
const HIDDEN = new Set(["trip", "slug"]);

/** Any of these in the sentence identifies what the card is about. */
const NAMES = /\{(trip|date|title)\}/;

describe("a card that hides its subject names it in words", () => {
  const writes = TOOLS.filter((tool) => tool.kind === "write");

  test("there are write tools to check, so this test cannot pass vacuously", () => {
    expect(writes.length).toBeGreaterThan(10);
  });

  for (const tool of writes) {
    test(`${tool.name}`, () => {
      // `properties` is what the model fills in; the hidden fields are the
      // ones the server resolves for it. A tool asking for neither is not
      // trip-scoped and has nothing to name.
      const asks = Object.keys(tool.properties ?? {});
      const hides = asks.filter((name) => HIDDEN.has(name));
      if (hides.length === 0) return;

      // The tool's own sentence key is its name in camelCase, which is the
      // convention every one of them follows. Read the English string.
      const camel = tool.name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
      const dictionary = JSON.parse(
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require("node:fs").readFileSync("site/locales/en.json", "utf8"),
      ) as Record<string, string>;
      const sentence = dictionary[`agent.tool.${camel}`];
      if (sentence === undefined) return; // a tool whose sentence is built elsewhere

      expect(
        NAMES.test(sentence),
        `${tool.name} hides ${hides.join(" and ")} and its sentence names nothing: ${sentence}`,
      ).toBe(true);
    });
  }
});
