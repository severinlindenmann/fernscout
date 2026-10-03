import { describe, expect, test } from "vitest";
import { suggestionsFor, USERNAME_RE, usernameFrom } from "@/lib/journalPath";
import { slugify } from "@/lib/tripId";

describe("B2815 usernameFrom", () => {
  test.each([
    ["Anna Keller", "anna-keller"],
    ["Zoë", "zoe"],
    ["Straße", "strasse"],
    ["Søren", "soren"],
    ["Łukasz", "lukasz"],
    ["李", ""],
    ["a", ""],
  ])("%s -> %s", (name, want) => expect(usernameFrom(name)).toBe(want));

  test("a 40-char name is cut at a dash and stays valid", () => {
    const out = usernameFrom("alexandria-christina-margarethe-von-hohenzollern".slice(0, 40));
    expect(out).toBe("alexandria-christina-margarethe");
    expect(USERNAME_RE.test(out)).toBe(true);
  });

  test("slugify pre-map", () => {
    expect(slugify("Æble Œuvre Đorđe Þór")).toBe("aeble-oeuvre-dorde-thor");
  });

  test("suggestions come from the typed name only", () => {
    expect(suggestionsFor("Anna Keller", 2026)).toEqual(["anna-keller-2026", "anna-keller-2", "anna-keller-3"]);
    expect(suggestionsFor("李")).toEqual([]);
    for (const s of suggestionsFor("alexandria-christina-margarethe", 2026)) expect(USERNAME_RE.test(s)).toBe(true);
  });
});
