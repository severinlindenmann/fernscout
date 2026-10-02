// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from "vitest";
import { publishAudienceLabel } from "@/lib/studio/publishAudience";
import { addAllAiTags, mergeTags, toggleTag } from "@/lib/studio/tagsMerge";
import { readLanguageAnswer, saveLanguageAnswer } from "@/lib/studio/languageAnswer";
import { initialSuggestionState, pickTitle, addCaptions, acceptSpelling } from "@/lib/studio/suggestionState";

describe("publishAudienceLabel — B2677 the primary button names the audience", () => {
  it("names the reader count for a private/guest day", () => {
    expect(publishAudienceLabel("private", 14)).toEqual({ kind: "readers", count: 14 });
    expect(publishAudienceLabel("guest", 3)).toEqual({ kind: "readers", count: 3 });
  });
  it("says 'everyone' for a public or link day, whatever readers is", () => {
    expect(publishAudienceLabel("public", 0)).toEqual({ kind: "everyone" });
    expect(publishAudienceLabel("link", 5)).toEqual({ kind: "everyone" });
  });
  it("says 'everyone' when readersOf returned null (anyone, no names)", () => {
    expect(publishAudienceLabel("private", null)).toEqual({ kind: "everyone" });
  });
});

describe("mergeTags — B2677 place + used-before + AI, deduped", () => {
  it("orders place, then used-before, then AI, deduping case-insensitively", () => {
    const chips = mergeTags("Paris", ["paris", "museum"], ["Museum", "art"], new Set(["paris"]));
    expect(chips.map((c) => c.tag)).toEqual(["paris", "museum", "art"]);
    expect(chips.map((c) => c.source)).toEqual(["place", "usedBefore", "ai"]);
  });
  it("selection reflects the caller's set, not the source", () => {
    const chips = mergeTags("paris", ["museum"], ["art"], new Set(["paris", "art"]));
    expect(chips.find((c) => c.tag === "paris")?.selected).toBe(true);
    expect(chips.find((c) => c.tag === "museum")?.selected).toBe(false);
    expect(chips.find((c) => c.tag === "art")?.selected).toBe(true);
  });
  it("drops a blank place and empty entries", () => {
    expect(mergeTags(null, ["", "x"], [], new Set()).map((c) => c.tag)).toEqual(["x"]);
  });
  it("addAllAiTags selects every AI chip, keeping what was already on", () => {
    const chips = mergeTags("paris", ["museum"], ["art", "food"], new Set(["paris"]));
    const next = addAllAiTags(chips, new Set(["paris"]));
    expect(next).toEqual(new Set(["paris", "art", "food"]));
  });
  it("toggleTag flips one tag without touching the rest", () => {
    const selected = new Set(["paris"]);
    expect(toggleTag(selected, "museum")).toEqual(new Set(["paris", "museum"]));
    expect(toggleTag(new Set(["paris", "museum"]), "paris")).toEqual(new Set(["museum"]));
  });
});

describe("languageAnswer — B2677 remembered per trip", () => {
  beforeEach(() => window.localStorage.clear());
  it("reads back what was saved, scoped to user and trip", () => {
    saveLanguageAnswer("ana", "italy-2026", "translate");
    expect(readLanguageAnswer("ana", "italy-2026")).toBe("translate");
    expect(readLanguageAnswer("ana", "other-trip")).toBeNull();
    expect(readLanguageAnswer("someone-else", "italy-2026")).toBeNull();
  });
  it("is null when nothing was ever saved", () => {
    expect(readLanguageAnswer("ana", "italy-2026")).toBeNull();
  });
});

describe("suggestionState — B2677 nothing applied before a tap", () => {
  it("starts with the date as the title, captions off, spelling untouched", () => {
    const s = initialSuggestionState();
    expect(s).toEqual({ titleChoice: null, captionsOn: false, spellingApplied: false });
  });
  it("only changes what was explicitly tapped", () => {
    const s = acceptSpelling(addCaptions(pickTitle(initialSuggestionState(), "A title")));
    expect(s).toEqual({ titleChoice: "A title", captionsOn: true, spellingApplied: true });
  });
});
