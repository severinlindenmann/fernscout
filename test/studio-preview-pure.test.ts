// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from "vitest";
import { messageFact, publishAudienceLabel, readersFact } from "@/lib/studio/publishAudience";
import { addAllAiTags, matchingUsedBeforeTags, mergeTags, tagPhotoIds, TAG_PHOTO_MAX, toggleTag } from "@/lib/studio/tagsMerge";
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

describe("tagPhotoIds — B2685 the day's own photographs offered to mode: tags", () => {
  it("collects image srcs across every part, in order", () => {
    const entries = [
      { gallery: [{ src: "a.jpg", type: "image" as const }, { src: "b.mp4", type: "video" as const }] },
      { gallery: [{ src: "c.jpg", type: "image" as const }] },
    ];
    expect(tagPhotoIds(entries)).toEqual(["a.jpg", "c.jpg"]);
  });
  it("never sends a video", () => {
    expect(tagPhotoIds([{ gallery: [{ src: "a.mp4", type: "video" as const }] }])).toEqual([]);
  });
  it("caps at TAG_PHOTO_MAX across all parts combined", () => {
    const manyImages = Array.from({ length: TAG_PHOTO_MAX + 3 }, (_, i) => ({ src: `${i}.jpg`, type: "image" as const }));
    expect(tagPhotoIds([{ gallery: manyImages }])).toHaveLength(TAG_PHOTO_MAX);
  });
  it("is empty with no entries", () => {
    expect(tagPhotoIds([])).toEqual([]);
  });
});

describe("matchingUsedBeforeTags — B2677, bug 12: not the whole history", () => {
  it("keeps only a tag that appears as a whole word in the day's own words", () => {
    expect(matchingUsedBeforeTags(["museum", "wildfire", "colorado"], "We saw a museum today.", null)).toEqual(["museum"]);
  });
  it("is case-insensitive, and matches the place exactly", () => {
    expect(matchingUsedBeforeTags(["Paris"], "Nothing about it here.", "paris")).toEqual(["paris"]);
  });
  it("never matches a substring that is not its own word", () => {
    expect(matchingUsedBeforeTags(["art"], "We went to a party.", null)).toEqual([]);
  });
  it("caps the result at max (default 5)", () => {
    const words = "one two three four five six";
    expect(matchingUsedBeforeTags(["one", "two", "three", "four", "five", "six"], words, null)).toEqual([
      "one", "two", "three", "four", "five",
    ]);
  });
  it("drops nothing that matches neither words nor place", () => {
    expect(matchingUsedBeforeTags(["colorado"], "A quiet day at home.", "paris")).toEqual([]);
  });
});

describe("readersFact — B2677, bug 11", () => {
  it("is 'everyone' for public/link, or when readerCount is null", () => {
    expect(readersFact("public", 9)).toEqual({ kind: "everyone" });
    expect(readersFact("link", 9)).toEqual({ kind: "everyone" });
    expect(readersFact("private", null)).toEqual({ kind: "everyone" });
  });
  it("names which count private/guest is counting", () => {
    expect(readersFact("private", 2)).toEqual({ kind: "private", count: 2 });
    expect(readersFact("guest", 14)).toEqual({ kind: "guest", count: 14 });
  });
});

describe("messageFact — B2677, bug 11: why nobody is told, said plainly", () => {
  it("is serverOff when the server sends no notifications at all", () => {
    expect(messageFact({ pushOn: false, mailOn: false, hasReaders: true, explicitChoice: true, push: 0, mail: 0 })).toEqual({ kind: "serverOff" });
  });
  it("is noneYet when nobody has notifications on, and nothing was chosen", () => {
    expect(messageFact({ pushOn: true, mailOn: true, hasReaders: false, explicitChoice: false, push: 0, mail: 0 })).toEqual({ kind: "noneYet" });
  });
  it("is chosenNone when the owner narrowed the audience to nobody", () => {
    expect(messageFact({ pushOn: true, mailOn: true, hasReaders: true, explicitChoice: true, push: 0, mail: 0 })).toEqual({ kind: "chosenNone" });
  });
  it("carries the real counts otherwise", () => {
    expect(messageFact({ pushOn: true, mailOn: true, hasReaders: true, explicitChoice: false, push: 8, mail: 5 })).toEqual({
      kind: "counts",
      push: 8,
      mail: 5,
    });
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
