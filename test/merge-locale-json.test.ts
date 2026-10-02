import { describe, expect, test } from "vitest";
import { mergeLocaleJson } from "../scripts/merge-locale-json.mjs";

/**
 * B2712 — the AGENTS.md rule for a site/locales/*.json conflict: both sides
 * only added → keep both; same key changed on both sides → main's value.
 * `mainSide` defaults to "theirs", the common case (git merge origin/main
 * from a feature branch puts main on %B/theirs).
 */
describe("mergeLocaleJson", () => {
  test("both sides only added different keys — keeps both", () => {
    const merged = mergeLocaleJson({ a: "1" }, { a: "1", b: "ours-new" }, { a: "1", c: "theirs-new" });
    expect(merged).toEqual({ a: "1", b: "ours-new", c: "theirs-new" });
  });

  test("same key changed on both sides to different values — main (theirs) wins", () => {
    const merged = mergeLocaleJson({ a: "orig" }, { a: "ours-edit" }, { a: "theirs-edit" }, { mainSide: "theirs" });
    expect(merged.a).toBe("theirs-edit");
  });

  test("same key changed on both sides — mainSide 'ours' keeps ours instead", () => {
    const merged = mergeLocaleJson({ a: "orig" }, { a: "ours-edit" }, { a: "theirs-edit" }, { mainSide: "ours" });
    expect(merged.a).toBe("ours-edit");
  });

  test("a dotted key is just a string key — nothing special about depth", () => {
    const merged = mergeLocaleJson(
      { "studio.hub.title": "orig" },
      { "studio.hub.title": "orig", "studio.hub.addDay.title": "ours-new" },
      { "studio.hub.title": "orig" },
    );
    expect(merged).toEqual({ "studio.hub.title": "orig", "studio.hub.addDay.title": "ours-new" });
  });

  test("only one side changed a key — takes the change", () => {
    const merged = mergeLocaleJson({ a: "orig" }, { a: "orig" }, { a: "theirs-edit" });
    expect(merged.a).toBe("theirs-edit");
    const merged2 = mergeLocaleJson({ a: "orig" }, { a: "ours-edit" }, { a: "orig" });
    expect(merged2.a).toBe("ours-edit");
  });

  test("both sides deleted a key — it stays gone", () => {
    const merged = mergeLocaleJson({ a: "orig", b: "keep" }, { b: "keep" }, { b: "keep" });
    expect(merged).toEqual({ b: "keep" });
  });

  test("one side deleted an unchanged key, the other left it alone — deletion wins", () => {
    const merged = mergeLocaleJson({ a: "orig", b: "keep" }, { b: "keep" }, { a: "orig", b: "keep" });
    expect(merged).toEqual({ b: "keep" });
  });

  test("ours deleted a key main (theirs) edited — theirs' edit wins since theirs is main", () => {
    const merged = mergeLocaleJson({ a: "orig" }, {}, { a: "theirs-edit" }, { mainSide: "theirs" });
    expect(merged.a).toBe("theirs-edit");
  });

  test("theirs deleted a key ours edited, and ours is main — ours' edit survives", () => {
    const merged = mergeLocaleJson({ a: "orig" }, { a: "ours-edit" }, {}, { mainSide: "ours" });
    expect(merged.a).toBe("ours-edit");
  });

  test("theirs deleted a key ours edited, and theirs is main — theirs' deletion wins", () => {
    const merged = mergeLocaleJson({ a: "orig" }, { a: "ours-edit" }, {}, { mainSide: "theirs" });
    expect(merged.a).toBeUndefined();
  });
});
