// B1587 phase 0: the v2 schemas ARE the spec, and this file is their
// self-check — the concept's own example documents parse, silent omission of
// a declinable section fails with the missing shape, and a conflict (brought
// AND declined) is refused.
import { describe, expect, it } from "vitest";
import {
  dayPatch,
  dayWrite,
  figureDoc,
  instanceStatus,
  journalDoc,
  journalStatus,
  journalWrite,
  mediaIntent,
  tripCreate,
  tripPatch,
} from "../lib/api/v2/schemas";

function withoutDecline(doc: typeof fullTrip, key: string) {
  const declined = { ...doc.declined } as Record<string, string>;
  delete declined[key];
  return { ...doc, declined };
}

const people = [{ name: "Example Owner", email: "owner@example.com" }];

const fullTrip = {
  id: "alps-2026",
  title: "Alps by rail",
  dates: { from: "2026-09-20", to: "2026-09-27" },
  visibility: "guest",
  teaser: false,
  people,
  rates: { currencies: ["CHF", "EUR"] },
  costs: { budget: { total: 1800, currency: "CHF" } },
  plan: { route: [{ location: "Grindelwald", lat: 46.62, lng: 8.03 }] },
  accent: "green",
  tagline: "Six passes in seven days",
  intro: "A week on the narrow-gauge lines.",
  declined: {
    buddies: "travelling solo this time",
    figures: "owner has not designed figures yet",
    days: "trip has not started yet",
    translations: "owner writes this journal in English only for now",
  },
};

const fullDay = {
  slug: "2026-09-21-grindelwald",
  title: "Up the valley",
  date: "2026-09-21",
  content: "We took the first train up.",
  coordinates: { lat: 46.62, lng: 8.03 },
  weather: true,
  time: "08:40",
  timezone: "Europe/Zurich",
  location: "Grindelwald",
  country: "Switzerland",
  countryCode: "CH",
  transportMode: "train",
  status: "draft",
  media: [{ src: "abc123", caption: "First light", visibility: "guest" }],
  declined: {
    costs: "nothing was spent — a walking day",
    tags: "owner does not tag their days",
    translations: "journal is written in English only",
    visibility: "shown to everyone the trip lets in",
  },
};

describe("required-or-declined", () => {
  it("accepts the concept's example trip", () => {
    expect(tripCreate.safeParse(fullTrip).success).toBe(true);
  });

  it("names every silently omitted section, not just the first", () => {
    const r = tripCreate.safeParse({
      id: "alps-2026",
      title: "Alps by rail",
      dates: { from: "2026-09-20", to: "2026-09-27" },
      visibility: "guest",
      teaser: false,
      people,
    });
    expect(r.success).toBe(false);
    const missing = r.error!.issues.filter((i) => "params" in i && (i as { params?: { v2?: string } }).params?.v2 === "missing");
    expect(missing.map((i) => i.path[0]).sort()).toEqual([
      "accent", "costs", "days", "figures", "intro", "people", "plan", "rates", "tagline", "translations",
    ]);
    // Each carries how to decline, so the refusal is the documentation.
    for (const issue of missing) {
      expect((issue as { params?: { toDecline?: string } }).params?.toDecline).toMatch(/^declined\./);
    }
  });

  it("rejects the retired status field — derived from the dates, stored nowhere", () => {
    expect(tripCreate.safeParse({ ...fullTrip, status: "current" }).success).toBe(false);
  });

  it("demands teaser on a closed trip and refuses it on a public one", () => {
    const noTeaser = { ...fullTrip } as Record<string, unknown>;
    delete noTeaser.teaser;
    expect(tripCreate.safeParse(noTeaser).success).toBe(false);
    expect(
      tripCreate.safeParse({ ...fullTrip, visibility: "public", teaser: false, listed: true }).success,
    ).toBe(false);
    expect(
      tripCreate.safeParse({ ...(noTeaser as object), visibility: "public", listed: true }).success,
    ).toBe(true);
    expect(tripCreate.safeParse({ ...fullTrip, teaser: true }).success).toBe(true);
  });

  it("asks the listed question of public trips only", () => {
    // A public trip must answer it (or decline it)…
    const pub = { ...fullTrip, visibility: "public" } as Record<string, unknown>;
    delete pub.teaser;
    expect(tripCreate.safeParse(pub).success).toBe(false);
    expect(tripCreate.safeParse({ ...pub, listed: true }).success).toBe(true);
    expect(
      tripCreate.safeParse({
        ...pub,
        declined: { ...fullTrip.declined, listed: "owner shares the link by hand" },
      }).success,
    ).toBe(true);
    // …and a closed trip may not even mention it.
    expect(tripCreate.safeParse({ ...fullTrip, listed: false }).success).toBe(false);
    expect(
      tripCreate.safeParse({
        ...fullTrip,
        declined: { ...fullTrip.declined, listed: "not applicable to this trip" },
      }).success,
    ).toBe(false);
  });

  it("asks the buddy question: a solo trip says so, a crewed trip has answered", () => {
    const decl = { ...fullTrip.declined } as Record<string, string>;
    delete decl.buddies;
    // Solo without the decline: refused, with the decline instruction.
    const r = tripCreate.safeParse({ ...fullTrip, declined: decl });
    expect(r.success).toBe(false);
    // Two people: the question is answered by the list itself…
    const two = [...people, { name: "Anna Example", email: "anna@example.com" }];
    expect(tripCreate.safeParse({ ...fullTrip, people: two, declined: decl }).success).toBe(true);
    // …and declining on top of a crew is a conflict.
    expect(tripCreate.safeParse({ ...fullTrip, people: two }).success).toBe(false);
  });

  it("refuses a section both brought and declined", () => {
    const r = tripCreate.safeParse({
      ...fullTrip,
      declined: { ...fullTrip.declined, rates: "single-currency trip" },
    });
    expect(r.success).toBe(false);
    expect(r.error!.issues.some((i) => (i as { params?: { v2?: string } }).params?.v2 === "conflict")).toBe(true);
  });

  it('refuses a throwaway decline reason ("n/a")', () => {
    const r = tripCreate.safeParse({ ...fullTrip, declined: { days: "n/a" } });
    expect(r.success).toBe(false);
  });

  it("has no decline path for people — a trip nobody was on is not a trip", () => {
    expect(tripCreate.safeParse({ ...fullTrip, people: [] }).success).toBe(false);
  });
});

describe("day", () => {
  it("accepts the concept's example day", () => {
    expect(dayWrite.safeParse(fullDay).success).toBe(true);
  });

  it('accepts status "draft" and nothing else — publish stays its own call', () => {
    expect(dayWrite.safeParse({ ...fullDay, status: "published" }).success).toBe(false);
    expect(dayWrite.safeParse(fullDay).success).toBe(true);
  });

  it("names every silently omitted day section in one round trip", () => {
    const r = dayWrite.safeParse({
      slug: "2026-09-21-grindelwald",
      title: "Up the valley",
      date: "2026-09-21",
      content: "We took the first train up.",
    });
    expect(r.success).toBe(false);
    const missing = r.error!.issues
      .filter((i) => (i as { params?: { v2?: string } }).params?.v2 === "missing")
      .map((i) => i.path[0]);
    expect(missing.length).toBe(14);
  });

  it("retired v1's per-field declines — costs: false is now a shape error", () => {
    expect(dayWrite.safeParse({ ...fullDay, costs: false }).success).toBe(false);
    const noCaps = { ...fullDay } as Record<string, unknown>;
    noCaps.captions = { abc123: "First light" };
    expect(dayWrite.safeParse(noCaps).success).toBe(false);
  });

  it("refuses weatherData claiming the server's own source", () => {
    const r = dayWrite.safeParse({
      ...fullDay,
      weather: { tempMax: 21.5, source: "open-meteo", recordedAt: "2026-09-21T18:00:00Z" },
    });
    expect(r.success).toBe(false);
  });

  it("accepts a real reading with a named source", () => {
    const r = dayWrite.safeParse({
      ...fullDay,
      weather: { tempMax: 21.5, source: "garmin fenix on the trip", recordedAt: "2026-09-21T18:00:00Z" },
    });
    expect(r.success).toBe(true);
  });

  it("refuses an implausible measurement", () => {
    const r = dayWrite.safeParse({
      ...fullDay,
      weather: { tempMax: 900, source: "own thermometer", recordedAt: "2026-09-21T18:00:00Z" },
    });
    expect(r.success).toBe(false);
  });
});

describe("patches (V2/T6)", () => {
  it("a day patch answers only the questions it raises", () => {
    expect(dayPatch.safeParse({ media: [{ src: "abc123", caption: "Late light" }] }).success).toBe(true);
    expect(dayPatch.safeParse({ declined: { costs: "nothing was spent that day" } }).success).toBe(true);
    // …but cannot contradict itself in one patch,
    expect(
      dayPatch.safeParse({ costs: [], declined: { costs: "nothing was spent that day" } }).success,
    ).toBe(false);
    // …and still refuses server-owned and unknown keys.
    expect(dayPatch.safeParse({ status: "published" }).success).toBe(false);
    expect(dayPatch.safeParse({ weathr: true }).success).toBe(false);
  });

  it("a trip patch refuses days and self-contradiction", () => {
    expect(tripPatch.safeParse({ tagline: "New subtitle after all" }).success).toBe(true);
    expect(tripPatch.safeParse({ days: [] }).success).toBe(false);
    expect(
      tripPatch.safeParse({ accent: "navy", declined: { accent: "keep the default colour" } }).success,
    ).toBe(false);
  });

  it("trip translations carry intro (T4)", () => {
    expect(
      tripPatch.safeParse({ translations: { de: { title: "Alpen", intro: "Eine Woche auf Schmalspur." } } }).success,
    ).toBe(true);
  });
});

describe("media intent", () => {
  it("asks each kind its own questions", () => {
    // bank_export: trip + format.
    expect(mediaIntent.safeParse({ kind: "bank_export" }).success).toBe(false);
    expect(
      mediaIntent.safeParse({
        kind: "bank_export",
        declined: {
          trip: "statement covers the whole year, spans several trips",
          format: "let the server detect the export format",
        },
      }).success,
    ).toBe(true);
    // photo: trip + day + caption.
    expect(
      mediaIntent.safeParse({
        kind: "photo",
        trip: "alps-2026",
        day: "2026-09-21-grindelwald",
        caption: "First light over the valley",
      }).success,
    ).toBe(true);
    expect(
      mediaIntent.safeParse({ kind: "photo", trip: "alps-2026", day: "2026-09-21-grindelwald" }).success,
    ).toBe(false);
  });

  it("refuses a question the kind is not asked", () => {
    expect(
      mediaIntent.safeParse({
        kind: "gps_history",
        caption: "my hike",
        declined: { trip: "whole-archive import spanning years", format: "let the server detect it" },
      }).success,
    ).toBe(false);
    expect(
      mediaIntent.safeParse({
        kind: "photo",
        trip: "alps-2026",
        format: "gpx",
        declined: { day: "not attached to a day yet", caption: "no caption for this one" },
      }).success,
    ).toBe(false);
  });
});

describe("status", () => {
  it("splits instance facts from journal standing", () => {
    expect(
      instanceStatus.safeParse({
        capabilities: { costs: true, weather: true },
        limits: { imageMaxEdge: 8000, imageMaxBytes: 52_428_800, videoMaxBytes: 209_715_200, videoMaxSeconds: 120, itemsPerDay: 30 },
        media: {
          kinds: ["photo", "bank_export", "gps_history", "document"],
          imageFormats: ["image/jpeg", "image/png"],
          videoFormats: ["video/mp4"],
          importFormats: { bank_export: ["revolut-csv"], gps_history: ["gpx", "google-timeline"] },
        },
        pricing: { postcard: 3, "storage-5gb": 10 },
      }).success,
    ).toBe(true);
    expect(
      journalStatus.safeParse({
        journal: "example",
        credits: 12,
        drafts: [{ trip: "alps-2026", slug: "2026-09-21-grindelwald" }],
        trips: [{ id: "alps-2026", title: "Alps by rail" }],
        storage: { usedBytes: 123_456, maxBytes: 5_000_000_000 },
        inbox: { media: 4, files: 1 },
        token: { scope: "owner", expiresAt: "2026-09-19T14:02:00Z" },
      }).success,
    ).toBe(true);
    // A journal answer does not carry instance facts.
    expect(journalStatus.safeParse({ journal: "example", capabilities: {} }).success).toBe(false);
  });
});

describe("figures", () => {
  it("accepts a figure from the real vocabulary and refuses outside it", () => {
    expect(
      figureDoc.safeParse({
        id: "anna-summer",
        name: "Anna",
        person: "anna@example.com",
        hairStyle: "ponytail",
        outfit: "shorts",
        age: "adult",
        skin: "#eec39a",
        accessories: ["sunglasses", "hat"],
      }).success,
    ).toBe(true);
    expect(figureDoc.safeParse({ id: "x", hairStyle: "mohawk" }).success).toBe(false);
    expect(figureDoc.safeParse({ id: "x", preset: "hiker" }).success).toBe(false);
  });

  it("trip figures: off, journal, or a custom set", () => {
    expect(tripCreate.safeParse({ ...withoutDecline(fullTrip, "figures"), figures: { mode: "journal" } }).success).toBe(true);
    expect(
      tripCreate.safeParse({
        ...withoutDecline(fullTrip, "figures"),
        figures: { mode: "custom", figures: ["anna-summer"] },
      }).success,
    ).toBe(true);
    expect(
      tripCreate.safeParse({ ...withoutDecline(fullTrip, "figures"), figures: { mode: "custom" } }).success,
    ).toBe(false);
  });
});

describe("journal", () => {
  const fullJournal = {
    title: "An example journal",
    owner: { name: "Example Owner", email: "owner@example.com" },
    locales: ["en", "de"],
    baseCurrency: "CHF",
    displayCurrencies: ["CHF", "EUR"],
    units: "metric",
    visibility: "public",
    declined: {
      tagline: "the title says it all already",
      figures: "owner prefers the plain map",
    },
  };

  it("accepts a complete journal", () => {
    expect(journalWrite.safeParse(fullJournal).success).toBe(true);
  });

  it("carries no features block — instance-only since the 2026-09-12 decision", () => {
    expect(journalWrite.safeParse({ ...fullJournal, features: { costs: { enabled: true } } }).success).toBe(false);
  });

  it("requires units, visibility and displayCurrencies including the base", () => {
    const bare = { ...fullJournal } as Record<string, unknown>;
    delete bare.units;
    expect(journalWrite.safeParse(bare).success).toBe(false);
    expect(
      journalWrite.safeParse({ ...fullJournal, displayCurrencies: ["EUR"] }).success,
    ).toBe(false);
  });

  it("refuses the retired journal-level blocks, and reads storage back read-only", () => {
    // The old journal-level knobs are gone — strict shape refuses them.
    expect(journalWrite.safeParse({ ...fullJournal, manualRates: { VND: 30500 } }).success).toBe(false);
    expect(journalWrite.safeParse({ ...fullJournal, media: { perUserBytes: 1 } }).success).toBe(false);
    expect(journalWrite.safeParse({ ...fullJournal, storageBytes: 1 }).success).toBe(false);
    // The read shape carries the server-owned identity…
    expect(journalDoc.safeParse({ ...fullJournal, username: "example" }).success).toBe(true);
    // …which the write shape refuses; the live numbers live on /status.
    expect(journalWrite.safeParse({ ...fullJournal, username: "example" }).success).toBe(false);
  });

  it("takes manual rates per trip, inside rates", () => {
    expect(
      tripCreate.safeParse({
        ...fullTrip,
        rates: { currencies: ["CHF", "VND"], manual: { VND: 30500 } },
      }).success,
    ).toBe(true);
    expect(
      tripCreate.safeParse({
        ...fullTrip,
        rates: { currencies: ["CHF", "VND"], manual: { VND: -1 } },
      }).success,
    ).toBe(false);
  });

  it("asks the tagline question", () => {
    const noDecl = {
      ...fullJournal,
      declined: { figures: "owner prefers the plain map" },
    } as Record<string, unknown>;
    expect(journalWrite.safeParse(noDecl).success).toBe(false);
    expect(
      journalWrite.safeParse({ ...noDecl, tagline: "Two of us, mostly by rail" }).success,
    ).toBe(true);
  });
});
