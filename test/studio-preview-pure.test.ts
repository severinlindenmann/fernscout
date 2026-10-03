// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from "vitest";
import { messageFact, publishAudienceLabel, reachActions, readersFact } from "@/lib/studio/publishAudience";
import { addAllAiTags, matchingUsedBeforeTags, mergeTags, tagPhotoIds, TAG_PHOTO_MAX, toggleTag } from "@/lib/studio/tagsMerge";
import { readLanguageAnswer, saveLanguageAnswer } from "@/lib/studio/languageAnswer";
import { initialSuggestionState, pickTitle, applyCompose, undoCompose } from "@/lib/studio/suggestionState";
import { hashInputs, readComposeCache, writeComposeCache, clearComposeCache } from "@/lib/studio/composeCache";
import { wordDiff } from "@/lib/studio/wordDiff";

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

describe("B2776 — a closed trip nobody else can open never says 0 readers", () => {
  it("private and guest days with no readers are 'onlyYou'; public stays 'everyone'", () => {
    expect(publishAudienceLabel("private", 0)).toEqual({ kind: "onlyYou" });
    expect(publishAudienceLabel("guest", 0)).toEqual({ kind: "onlyYou" });
    expect(publishAudienceLabel("public", 0)).toEqual({ kind: "everyone" });
  });
  it("a private trip's doors are People and the trip's visibility, never the readers invite", () => {
    expect(reachActions("private", "/@a", "t 1")).toEqual([
      { key: "studio.reach.addSomeone", href: "/@a/studio/people" },
      { key: "studio.reach.letReadersIn", href: "/@a/studio/trip/visibility?trip=t%201" },
    ]);
    expect(reachActions("private", "/@a", "t").some((a) => a.href.includes("readers#invite"))).toBe(false);
  });
  it("a guest trip with no readers yet offers the readers invite and the visibility page", () => {
    expect(reachActions("guest", "/@a", "t").map((a) => a.key)).toEqual(["studio.reach.inviteReader", "studio.reach.changeWho"]);
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

describe("hashInputs/composeCache — B2689 reopening with nothing changed fires no call", () => {
  const key = { username: "ana", tripId: "italy-2026", slug: "day-1" };
  beforeEach(() => window.sessionStorage.clear());
  it("hashes the same inputs to the same value", () => {
    expect(hashInputs("notes", ["a.jpg"], [])).toBe(hashInputs("notes", ["a.jpg"], []));
  });
  it("a different note, photo or answer changes the hash", () => {
    const base = hashInputs("notes", ["a.jpg"], []);
    expect(hashInputs("other notes", ["a.jpg"], [])).not.toBe(base);
    expect(hashInputs("notes", ["a.jpg", "b.jpg"], [])).not.toBe(base);
    expect(hashInputs("notes", ["a.jpg"], ["an answer"])).not.toBe(base);
  });
  it("writes and reads back a cache hit only for the matching hash", () => {
    const hash = hashInputs("notes", [], []);
    expect(readComposeCache(key, hash)).toBeNull();
    writeComposeCache(key, hash, { ok: true });
    expect(readComposeCache(key, hash)).toEqual({ ok: true });
    expect(readComposeCache(key, hashInputs("different", [], []))).toBeNull();
  });
  it("clearComposeCache removes it", () => {
    const hash = hashInputs("notes", [], []);
    writeComposeCache(key, hash, { ok: true });
    clearComposeCache(key);
    expect(readComposeCache(key, hash)).toBeNull();
  });
});

describe("wordDiff — B2689 'what changed' underlines only the words that differ", () => {
  it("marks nothing changed when the text is identical", () => {
    expect(wordDiff("a quiet day", "a quiet day")).toEqual([
      { text: "a", changed: false },
      { text: "quiet", changed: false },
      { text: "day", changed: false },
    ]);
  });
  it("marks an inserted or changed word, keeping the rest unchanged", () => {
    const diff = wordDiff("train to Ljubljana", "Train to beautiful Ljubljana");
    expect(diff.map((d) => d.changed)).toEqual([false, false, true, false]);
  });
  it("is case/punctuation-insensitive for matching, not for display", () => {
    const diff = wordDiff("slept most of it", "Slept most of it.");
    expect(diff.every((d) => !d.changed)).toBe(true);
    expect(diff[0].text).toBe("Slept");
  });
});

describe("suggestionState — B2689 nothing composed is applied before a tap", () => {
  it("starts with the date as the title and nothing composed applied", () => {
    const s = initialSuggestionState();
    expect(s).toEqual({ titleChoice: null, composeApplied: null });
  });
  it("only changes what was explicitly tapped, and undo clears it again", () => {
    const applied = applyCompose(pickTitle(initialSuggestionState(), "A title"), "story");
    expect(applied).toEqual({ titleChoice: "A title", composeApplied: "story" });
    expect(undoCompose(applied)).toEqual({ titleChoice: "A title", composeApplied: null });
  });
});
