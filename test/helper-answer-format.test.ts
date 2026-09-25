import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { parseAnswer } from "@/lib/helper/answer";
import { claimsAWrite } from "@/lib/helper/model";

/**
 * The four marks B1120 declares, and nothing else — `lib/helper/answer.ts`.
 *
 * The acceptance line this file exists for: an unsupported mark renders as
 * its own literal text rather than vanishing. The rest is here because a
 * hand-written parser over four cases is exactly the kind of thing that is
 * silently wrong about the fifth case nobody tried.
 */
describe("parseAnswer", () => {
  test("bold names a thing, and the asterisks never reach the screen as text", () => {
    const blocks = parseAnswer("The day **The night train north** is a draft.");
    expect(blocks).toEqual([
      {
        kind: "text",
        parts: [
          { bold: false, text: "The day " },
          { bold: true, text: "The night train north" },
          { bold: false, text: " is a draft." },
        ],
      },
    ]);
  });

  test("two or more `- ` lines are a list", () => {
    const blocks = parseAnswer("Two trips:\n- Alps 2024\n- Danube Circuit");
    expect(blocks).toEqual([
      { kind: "text", parts: [{ bold: false, text: "Two trips:" }] },
      {
        kind: "list",
        items: [
          [{ bold: false, text: "Alps 2024" }],
          [{ bold: false, text: "Danube Circuit" }],
        ],
      },
    ]);
  });

  test("one `- ` line is not a list — it degrades to a plain, readable line", () => {
    const blocks = parseAnswer("- Alps 2024");
    expect(blocks).toEqual([{ kind: "text", parts: [{ bold: false, text: "- Alps 2024" }] }]);
  });

  test("`> ` marks words that came out of the journal", () => {
    const blocks = parseAnswer('They wrote:\n> Thirteen hours, a bunk with a curtain.');
    expect(blocks).toEqual([
      { kind: "text", parts: [{ bold: false, text: "They wrote:" }] },
      { kind: "quote", lines: [[{ bold: false, text: "Thirteen hours, a bunk with a curtain." }]] },
    ]);
  });

  test("`~` marks a meta line of counts or state", () => {
    const blocks = parseAnswer("**Alps 2024**\n~ 12 days · 340 photos · draft");
    expect(blocks).toEqual([
      { kind: "text", parts: [{ bold: true, text: "Alps 2024" }] },
      { kind: "meta", text: "12 days · 340 photos · draft" },
    ]);
  });

  test("an unsupported mark degrades to a readable sentence rather than vanishing", () => {
    // Headings, links and tables are not in the vocabulary — B1120's Work
    // section rules them out by name. None of them may disappear.
    for (const line of [
      "# A heading",
      "[the day](https://example.test/day)",
      "| col | col |",
      "* not a bullet, single star",
      "Unclosed **bold that never closes",
    ]) {
      const blocks = parseAnswer(line);
      const text = blocks
        .flatMap((b) => (b.kind === "text" ? b.parts : b.kind === "meta" ? [{ text: b.text }] : []))
        .map((p) => p.text)
        .join("");
      expect(text).toBe(line);
    }
  });

  test("an empty line is kept, not dropped, so paragraph breaks survive", () => {
    expect(parseAnswer("First.\n\nSecond.")).toEqual([
      { kind: "text", parts: [{ bold: false, text: "First." }] },
      { kind: "text", parts: [{ bold: false, text: "" }] },
      { kind: "text", parts: [{ bold: false, text: "Second." }] },
    ]);
  });
});

/**
 * **The thing to be careful about** — the honesty net in `lib/helper/model.ts`
 * reads the answer text raw, and this rendering must sit strictly after it.
 */
describe("rendering never reaches the honesty net", () => {
  test("lib/helper/model.ts does not import the renderer or the parser", () => {
    // A guard tuned against the string the model wrote must keep seeing that
    // exact string. Importing the parser into model.ts is the shape of bug
    // that would let a normalised sentence slip past a matcher tuned for the
    // model's own words — so this asserts the import never happens, rather
    // than trusting a comment to keep saying so.
    const source = fs.readFileSync(path.join(process.cwd(), "lib/helper/model.ts"), "utf8");
    expect(source).not.toMatch(/from ["']\.\/answer["']/);
    expect(source).not.toMatch(/from ["']@\/lib\/helper\/answer["']/);
  });

  test("a write claim written in the journal's own bold mark is still caught", () => {
    // The guards match on the answer as the model actually wrote it — markup
    // included. A false negative here would mean the net had started reading
    // something other than what reaches the screen.
    expect(claimsAWrite("The **14th** is saved.")).toBe(true);
  });
});
