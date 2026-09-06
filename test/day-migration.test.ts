import { describe, expect, test } from "vitest";
import { agentGuide } from "@/lib/api/documentation";
import { FRONTMATTER_TO_API } from "@/lib/api/agentCopy";
import { EDITABLE_DAY_FIELDS } from "@/lib/api/entries";

/**
 * B533 — the guide had a section for a folder of photographs and none for a
 * journal that already exists in the content format moving to a hosted
 * instance, which is the run that actually happened. The agent that did it
 * read its own filtered summary of the entries instead of the entries, and
 * said afterwards that a field table would have forced it to look at every
 * key rather than the ones it remembered.
 *
 * So the table has to stay complete on its own, rather than by anybody
 * remembering to add a row.
 */
describe("the frontmatter-to-API table", () => {
  test("covers every field a day can be written or edited with", () => {
    const documented = new Set(FRONTMATTER_TO_API.flatMap((f) => f.key.split(" / ")));
    for (const field of EDITABLE_DAY_FIELDS) {
      // `captions` and `photoVisibility` are a photograph's fields rather than
      // a day's — the gallery rows are where the table sends you, and they say
      // so. Both are keyed there by what the *frontmatter* calls them, which
      // is the column this table is about: `caption:` and `visibility:` inside
      // a gallery item, not the names a PATCH body gives them.
      if (field === "captions" || field === "photoVisibility") continue;
      expect(documented, `${field} is writable and is not in FRONTMATTER_TO_API`).toContain(field);
    }
  });

  test("names the keys that do not cross, since sending them writes nothing", () => {
    const notCrossing = FRONTMATTER_TO_API.filter((f) => f.api.startsWith("—")).map((f) => f.key);
    expect(notCrossing).toContain("gallery");
    expect(notCrossing).toContain("status: draft");
  });

  test("is in the guide, with the warning that produced it", () => {
    const flat = agentGuide().replace(/\s+/g, " ");
    expect(flat).toMatch(/A journal that already exists, moving here/);
    expect(flat).toMatch(/read each day's whole frontmatter rather than the keys you remember/i);
    // And the reconciliation, which is the half an agent skips.
    expect(flat).toMatch(/a 201 means "written", not "complete"/i);
  });
});
