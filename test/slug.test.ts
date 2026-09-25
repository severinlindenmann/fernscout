import { describe, expect, test } from "vitest";
import { slugify } from "@/lib/slug.ts";

/**
 * One slugify, and what it does to a letter that is not ASCII.
 *
 * A slug is the permanent half of a permalink: it is what gets shared, and
 * renaming it later breaks whatever was shared. So this file is a table, not
 * a handful of examples — every letter the function treats specially is
 * written down here, and adding one to the table in lib/slug.ts without
 * adding it here is meant to feel like an omission.
 *
 * B77: there used to be two of these functions, one in lib/api/entries.ts and
 * one in lib/ingest/entry.ts, and they disagreed. "Ærøskøbing" was
 * `aeroskobing` through photo ingest and `r-sk-bing` through the API — the
 * same day title, two permanent URLs, depending on which door it came in by.
 */
describe("slugify", () => {
  test.each([
    // The bug that started B77. Without the expansion this is `ruckfahrt`,
    // which in German is a different word (Ruck, a jolt).
    ["Rückfahrt", "rueckfahrt"],
    ["Grüße vom Weg", "gruesse-vom-weg"],
    ["Zürich", "zuerich"],
    ["Österreich", "oesterreich"],
    ["Ähnlich", "aehnlich"],
    ["Straße", "strasse"],
    // Letters NFD cannot take apart: they are letters, not accented vowels.
    ["Ærøskøbing", "aeroskobing"],
    ["Œuvre", "oeuvre"],
    ["Þingvellir", "thingvellir"],
    ["Łódź", "lodz"],
    ["Đà Lạt", "da-lat"],
    // GeoNames often writes the eth where Vietnamese writes d-with-stroke.
    ["Ðà Lạt", "da-lat"],
    // Vietnamese tone marks are diacritics on a vowel, and the vowel stays.
    ["Hội An", "hoi-an"],
    ["Thành phố Huế", "thanh-pho-hue"],
    ["Đường Lâm", "duong-lam"],
    // French and Spanish: accents come off, nothing expands.
    ["Café Crème", "cafe-creme"],
    ["Peñíscola", "peniscola"],
    // Scandinavian ring and slash keep their single-letter forms — see the
    // rule written next to the table in lib/slug.ts.
    ["Ångström", "angstroem"],
    ["Tromsø", "tromso"],
  ])("%s -> %s", (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  test("input already decomposed slugs the same as input composed", () => {
    // macOS hands filenames and folder names over in NFD, so a location read
    // off a memory card arrives with the diaeresis as a separate codepoint.
    // The expansion has to see the composed letter, or it never fires.
    expect("Rückfahrt".normalize("NFD")).not.toBe("Rückfahrt".normalize("NFC"));
    expect(slugify("Rückfahrt".normalize("NFD"))).toBe("rueckfahrt");
    expect(slugify("Ångström".normalize("NFD"))).toBe("angstroem");
  });

  test("what is left is safe for a filename and for a URL", () => {
    expect(slugify("Lanterns of Hội An!")).toBe("lanterns-of-hoi-an");
    expect(slugify("../../etc/passwd")).toBe("etc-passwd");
    expect(slugify("a  --  b")).toBe("a-b");
  });

  test("a title with nothing to slug still names a file", () => {
    expect(slugify("")).toBe("entry");
    expect(slugify("!!!")).toBe("entry");
    expect(slugify("日本")).toBe("entry");
  });

  test("long titles are cut to 60 characters and never end on a hyphen", () => {
    const slug = slugify(`${"a".repeat(59)} tail`);
    expect(slug).toHaveLength(59);
    expect(slug).toBe("a".repeat(59));
    expect(slugify("x".repeat(80))).toHaveLength(60);
  });
});
