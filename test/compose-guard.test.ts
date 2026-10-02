import { describe, expect, test } from "vitest";
import {
  BANNED_PHRASES,
  bannedHits,
  checkVariant,
  keptTitles,
  type ComposeVariant,
  type GuardContext,
  type GuardItem,
} from "@/lib/helper/composeGuard";

/**
 * B2688 — each compose guard, one passing and one failing case. Pure
 * functions over a hand-built item list; nothing here calls a model.
 */

const NOTES =
  "Bus to the pass, three hours. Ate noodles at the shack by the barrier, 18 CHF. Met Anna at 14:30 by the gate. The wind never stopped all afternoon and the shack had one table.";

const ITEMS: GuardItem[] = [
  { id: "date", kind: "owner", text: "2026-05-04, day 4 of 9" },
  { id: "place", kind: "owner", text: "Kunlun Pass, China" },
  { id: "weather", kind: "measured", text: "3–9°C, snow" },
  { id: "n1", kind: "owner", text: "Bus to the pass, three hours." },
  { id: "n2", kind: "owner", text: "Ate noodles at the shack by the barrier, 18 CHF." },
  { id: "n3", kind: "owner", text: "Met Anna at 14:30 by the gate." },
  { id: "n4", kind: "owner", text: "The wind never stopped all afternoon and the shack had one table." },
  { id: "p1", kind: "seen", text: "A red bus parked beside a snowy barrier", },
  { id: "photoSpan", kind: "measured", text: "camera clock 09:12–16:40, 4 photos" },
];

function ctx(over: Partial<GuardContext> = {}): GuardContext {
  return {
    items: ITEMS,
    voice: ["Last spring in Lisbon with Mara we paid 42 euros for sardines."],
    date: "2026-05-04", // a Monday, in May
    partySize: 1,
    languages: ["en"],
    ...over,
  };
}

function one(text: string, sources: string[]): ComposeVariant {
  return { titles: [], paragraphs: [{ sentences: [{ text, sources }] }] };
}

function reasons(variant: ComposeVariant, which: "close" | "story" = "close", c = ctx()) {
  return checkVariant(c, variant, which);
}

describe("1 — every source exists", () => {
  test("a known id passes", () => {
    expect(reasons(one("Bus to the pass, three hours.", ["n1"])).ok).toBe(true);
  });
  test("an unknown id fails", () => {
    const v = reasons(one("Bus to the pass, three hours.", ["n9"]));
    expect(v.ok).toBe(false);
    expect(v.reasons.join()).toMatch(/unknown n9/);
  });
});

describe("2 — names and numbers come from the cited items", () => {
  test("a name in its own source passes", () => {
    expect(reasons(one("Met Anna by the gate.", ["n3"])).ok).toBe(true);
  });
  test("an invented capitalised place fails", () => {
    const v = reasons(one("Met Anna by the gate in Golmud.", ["n3"]));
    expect(v.reasons.join()).toMatch(/"Golmud" not in its sources/);
  });
  test("a name from the day but not from the cited item fails", () => {
    expect(reasons(one("Met Anna on the Kunlun road.", ["n3"])).ok).toBe(false);
    expect(reasons(one("Met Anna on the Kunlun road.", ["n3", "place"])).ok).toBe(true);
  });
  test("a number in its cited source passes", () => {
    expect(reasons(one("Noodles at the shack, 18 CHF.", ["n2"])).ok).toBe(true);
  });
  test("a number not in its cited source fails", () => {
    const v = reasons(one("Noodles at the shack, 18 CHF.", ["n1"]));
    expect(v.reasons.join()).toMatch(/number 18/);
  });
  test("measured weather numbers pass when weather is cited", () => {
    expect(reasons(one("It was 3 to 9°C.", ["weather"])).ok).toBe(true);
    expect(reasons(one("It was 3 to 9°C.", ["n4"])).ok).toBe(false);
  });
  test("an uncited sentence may connect, but carries no detail of its own", () => {
    expect(reasons(one("Then the wind.", [])).ok).toBe(true);
    expect(reasons(one("Then the glacier.", [])).ok).toBe(false);
  });
});

describe("3 — clock times and calendar words", () => {
  test("a clock time from a cited note passes", () => {
    expect(reasons(one("Met Anna at 14:30.", ["n3"])).ok).toBe(true);
  });
  test("a camera clock time fails even when its photo item is cited", () => {
    const v = reasons(one("Took the bus at 09:12.", ["photoSpan", "n1"]));
    expect(v.reasons.join()).toMatch(/clock time 09:12 not in a cited note/);
  });
  test("the day's own weekday and month pass", () => {
    expect(reasons(one("A Monday in May, three hours on a bus.", ["n1", "date"])).ok).toBe(true);
  });
  test("a weekday that disagrees with the date fails", () => {
    const v = reasons(one("A Friday, three hours on a bus.", ["n1", "date"]));
    expect(v.reasons.join()).toMatch(/Friday does not match 2026-05-04/);
  });
  test("an English modal 'may' is not a month", () => {
    expect(reasons(one("The wind may have never stopped.", ["n4"])).ok).toBe(true);
  });
});

describe("4 — banned phrases", () => {
  test("a banned phrase is reported apart from other reasons", () => {
    const v = reasons(one("The shack was charming.", ["n2"]));
    expect(v.ok).toBe(false);
    expect(v.reasons).toEqual([]);
    expect(v.banned).toEqual(["charming"]);
  });
  test("an inflected German one is caught", () => {
    expect(bannedHits("Ein unvergesslicher Abend.", ["de"], "")).toEqual(["unvergesslich"]);
  });
  test("a banned word the owner wrote themselves is exempt", () => {
    expect(bannedHits("A stunning view.", ["en"], "honestly stunning view")).toEqual([]);
    const own: GuardItem[] = [...ITEMS, { id: "a1", kind: "owner", text: "The shack was charming." }];
    expect(reasons(one("The shack was charming.", ["a1"]), "close", ctx({ items: own })).ok).toBe(true);
  });
  test("apostrophes do not hide one", () => {
    expect(bannedHits("We couldn’t help but laugh.", ["en"], "")).toEqual(["couldn't help but"]);
  });
});

describe("5 — 'we' needs a party or the writer's own 'we'", () => {
  test("'we' with party_size 1 and notes that never say it fails", () => {
    const v = reasons(one("We took the bus to the pass.", ["n1"]));
    expect(v.reasons.join()).toMatch(/travels alone/);
  });
  test("'we' with a party passes", () => {
    expect(reasons(one("We took the bus to the pass.", ["n1"]), "close", ctx({ partySize: 2 })).ok).toBe(true);
  });
  test("'we' when the notes use it passes", () => {
    const items: GuardItem[] = [...ITEMS, { id: "n5", kind: "owner", text: "we left early" }];
    expect(reasons(one("We took the bus to the pass.", ["n1"]), "close", ctx({ items })).ok).toBe(true);
  });
});

describe("6 — voice samples are style only", () => {
  test("a name only in a voice sample fails, whatever it cites", () => {
    const v = reasons(one("Met Anna and Mara at the gate.", ["n3"]));
    expect(v.reasons.join()).toMatch(/"Mara" only in a voice sample/);
  });
  test("a number only in a voice sample fails", () => {
    const v = reasons(one("Noodles at the shack, 42 CHF.", ["n2"]));
    expect(v.reasons.join()).toMatch(/number 42 from a voice sample/);
  });
  test("a word in both the day and a voice sample passes", () => {
    expect(reasons(one("Bus to the pass, three hours.", ["n1"])).ok).toBe(true);
  });
});

describe("7 — length", () => {
  const long = Array.from({ length: 5 }, () => "Bus to the pass, three hours, and the wind never stopped all afternoon.").join(" ");
  test("a close well past the notes' length fails", () => {
    const v = reasons(one(long, ["n1", "n4"]));
    expect(v.reasons.join()).toMatch(/close: \d+ words, at most/);
  });
  test("a story within three times the notes passes", () => {
    expect(reasons(one(long, ["n1", "n4"]), "story").ok).toBe(true);
  });
  test("a story over three times the notes fails", () => {
    const longer = Array.from({ length: 12 }, () => long).join(" ");
    expect(reasons(one(longer, ["n1", "n4"]), "story").reasons.join()).toMatch(/story: \d+ words/);
  });
  test("the notes here are over the story floor", () => {
    expect(NOTES.split(/\s+/).length).toBeGreaterThanOrEqual(25);
  });
});

describe("8 — titles", () => {
  test("a grounded label and a real quote are kept", () => {
    const kept = keptTitles(ctx(), [
      { text: "Noodles at the barrier", kind: "label", sources: ["n2"] },
      { text: "The wind never stopped", kind: "quote", sources: ["n4"] },
    ]);
    expect(kept.titles.map((t) => t.text)).toEqual(["Noodles at the barrier", "The wind never stopped"]);
  });
  test("a quote not in the notes is dropped", () => {
    const kept = keptTitles(ctx(), [{ text: "The wind stopped the bus", kind: "quote", sources: ["n4"] }]);
    expect(kept.titles).toEqual([]);
    expect(kept.reasons.join()).toMatch(/quote title/);
  });
  test("a title with a word the day never had is dropped", () => {
    const kept = keptTitles(ctx(), [{ text: "Glacier noodles", kind: "label", sources: ["n2"] }]);
    expect(kept.titles).toEqual([]);
  });
});

test("every locale's banned list is non-empty", () => {
  for (const lang of ["en", "de", "fr", "it", "hu"]) expect(BANNED_PHRASES[lang]?.length).toBeGreaterThan(0);
});

describe("tuning after the owner's own days (B2688)", () => {
  const de: GuardItem[] = [
    { id: "date", kind: "owner", text: "2025-06-07, day 2 of 5" },
    { id: "n1", kind: "owner", text: "heut frueh los, bus verpasst" },
    { id: "p1", kind: "seen", text: "Ein Steg an einem See, ein Herrenhaus dahinter" },
  ];
  const deCtx = (over: Partial<GuardContext> = {}) => ctx({ items: de, language: "de", languages: ["de"], ...over });
  const withNames = (text: string, names: string[], sources: string[]): ComposeVariant => ({
    titles: [],
    paragraphs: [{ sentences: [{ text, names, sources }] }],
  });

  test("German nouns are not names: a tidied note passes", () => {
    expect(reasons(withNames("Heute früh los, den Bus verpasst.", [], ["n1"]), "close", deCtx()).ok).toBe(true);
  });
  test("a reported name the sources lack fails, in German too", () => {
    const v = reasons(withNames("Am Steg in Vemdalen.", ["Vemdalen"], ["p1"]), "story", deCtx());
    expect(v.reasons.join()).toMatch(/name "Vemdalen" not in its sources/);
  });
  test("a word sharing its first four letters with a cited word is grounded", () => {
    const v = reasons(one("Heute los, Bus verpasst.", ["n1"]), "close", ctx({ items: de }));
    expect(v.reasons.join()).not.toMatch(/Heute/);
  });
  test("a photo-told story may run past three times a short note", () => {
    const text = "Heute früh los. Ein Steg an einem See, dahinter ein Herrenhaus, still und hell, und weiter hinten noch einmal der Steg mit dem See.";
    expect(reasons(one(text, ["n1", "p1"]), "story", deCtx()).reasons.join()).toMatch(/at most 15/);
    expect(reasons(one(text, ["n1", "p1"]), "story", deCtx({ storyFloor: 70 })).ok).toBe(true);
  });
});

describe("photographs alone say what they show (B2688 eval)", () => {
  const items: GuardItem[] = [
    { id: "n1", kind: "owner", text: "Nachtschlitteln." },
    { id: "p1", kind: "seen", text: "Zwei Personen mit Stirnlampen im Schnee zwischen kahlen Bäumen" },
  ];
  const c = () => ctx({ items, language: "de", languages: ["de"], partySize: 3, storyFloor: 70 });
  test("a head count from a photo is struck", () => {
    expect(reasons(one("Mit Stirnlampen standen sie zu zweit im Schnee.", ["p1"]), "story", c()).reasons.join()).toMatch(/zu zweit/);
  });
  test("a time of day from a photo is struck", () => {
    expect(reasons(one("Abends Stirnlampen im Schnee.", ["p1"]), "story", c()).reasons.join()).toMatch(/Abends/);
  });
  test("what the photo shows passes", () => {
    expect(reasons(one("Stirnlampen im Schnee, zwischen kahlen Bäumen.", ["p1"]), "story", c()).ok).toBe(true);
  });
  test("the same words pass when a note carries them", () => {
    expect(reasons(one("Nachtschlitteln, später Stirnlampen im Schnee.", ["n1", "p1"]), "story", c()).reasons.join()).not.toMatch(/photographs alone/);
  });
});
