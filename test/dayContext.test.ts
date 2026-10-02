import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { buildDayContext, allowedText, packText, renderDayPack, seenText } from "@/lib/helper/dayContext";
import { writeTripSidecar } from "@/lib/sidecar";
import { writeDayFixture, writeTripFixture } from "./fixtures/content";

/**
 * B2687 — `buildDayContext`/`renderDayPack`, against a temp journal built
 * the same way `test/home-place.test.ts` builds one. Never content/example:
 * AGENTS.md says not to touch it, and a temp `CONTENT_DIR` is the pattern
 * every other content test in this file already uses.
 */

const OWNER = "dc";
const TRIP = "lisbon-2026";
const HOME = { lat: 47.3769, lng: 8.5417 }; // Zürich
const LISBON = { lat: 38.7223, lng: -9.1393 };

let dir: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-day-pack-"));
  process.env.CONTENT_DIR = dir;
  fs.mkdirSync(path.join(dir, OWNER), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "Test journal",
      owner: { name: "Test Person", nickname: "Test", email: "owner@dc.test" },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
    }),
  );
  const { clearConfigCache } = await import("@/lib/config");
  const { clearUserCache } = await import("@/lib/users");
  clearConfigCache();
  clearUserCache();

  // The shape `docs/gps.md` documents, written directly — see
  // test/home-place.test.ts.
  fs.mkdirSync(path.join(dir, OWNER, "gps"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "gps", "exclude.json"),
    JSON.stringify([{ label: "home", lat: HOME.lat, lon: HOME.lng, radiusM: 300 }]),
  );

  writeTripFixture(OWNER, {
    id: TRIP,
    title: "Lisbon",
    start: "2026-05-01",
    end: "2026-05-04",
    visibility: "public",
    listed: true,
    intro: "A long weekend.",
    people: [{ name: "Alex Example", email: "alex@dc.test", nickname: "Alex" }],
  });

  writeDayFixture(dir, OWNER, TRIP, {
    slug: "arrival",
    date: "2026-05-01",
    location: "Zürich",
    country: "Switzerland",
    coordinates: HOME,
    content: "Left early for the airport.",
  });
  writeDayFixture(dir, OWNER, TRIP, {
    slug: "mirador",
    date: "2026-05-02",
    location: "Lisbon",
    country: "Portugal",
    coordinates: LISBON,
    content: "We climbed to the mirador before lunch. Paid 18 EUR for the funicular. It rained for an hour.",
    media: [{ src: `/media/${TRIP}/castle.jpg`, caption: "the owner's own caption" }],
    weather: { tempMin: 14, tempMax: 21, code: 61, source: "the hotel's own thermometer", recordedAt: "2026-05-02T18:00:00Z" },
    costs: [{ label: "funicular", amount: 18, category: "transport", currency: "EUR" }],
  });
  writeDayFixture(dir, OWNER, TRIP, {
    slug: "departure",
    date: "2026-05-03",
    location: "Lisbon",
    country: "Portugal",
    coordinates: LISBON,
    content: "Slow morning, flew home in the evening.",
  });
  writeDayFixture(dir, OWNER, TRIP, {
    slug: "rehearsal",
    date: "2026-05-04",
    location: "Lisbon",
    country: "Portugal",
    coordinates: LISBON,
    content: "Not real, just proving the pipeline works end to end.",
    test: true,
  });

  writeTripSidecar(`${OWNER}/${TRIP}`, "castle.jpg", {
    takenAt: "2026-05-02T09:31:00",
    described: {
      caption: { en: "the castle at dawn" },
      altText: { en: "steam over an outdoor pool near the castle wall" },
      longDescription: { en: null },
      tags: ["architecture"],
      confidence: "high",
      subject: null,
      people: 0,
      printworthiness: 4,
      at: new Date().toISOString(),
      model: "test",
      schemaVersion: 1,
      contentHash: "deadbeef",
    } as never,
  });

  // A second, older trip so the voice-sample pool has somewhere else to
  // draw from, and so "excludes test days / drafts" has something real to
  // exclude.
  writeTripFixture(OWNER, {
    id: "porto-2025",
    title: "Porto",
    start: "2025-04-01",
    end: "2025-04-02",
    visibility: "public",
    listed: true,
    intro: "Earlier.",
  });
  writeDayFixture(dir, OWNER, "porto-2025", {
    slug: "day-one",
    date: "2025-04-01",
    location: "Porto",
    country: "Portugal",
    content:
      "A published day from a previous trip, long enough to be truncated at a thousand characters if this test ever grows it that far. ".repeat(3),
  });
  writeDayFixture(dir, OWNER, "porto-2025", {
    slug: "draft-day",
    date: "2025-04-02",
    location: "Porto",
    country: "Portugal",
    content: "Never published, must never be a voice sample.",
    status: "draft",
  });
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("buildDayContext", () => {
  test("a day at home sends Home, never the real town", () => {
    const pack = buildDayContext(OWNER, TRIP, "arrival")!;
    const place = pack.facts.find((f) => f.id === "place")!;
    expect(place.text).toBe("Home, Home");
  });

  test("a day away names the real place", () => {
    const pack = buildDayContext(OWNER, TRIP, "mirador")!;
    const place = pack.facts.find((f) => f.id === "place")!;
    expect(place.text).toBe("Lisbon, Portugal");
  });

  test("ids are stable across the same day", () => {
    const a = buildDayContext(OWNER, TRIP, "mirador")!;
    const b = buildDayContext(OWNER, TRIP, "mirador")!;
    expect(a.facts.map((f) => f.id)).toEqual(b.facts.map((f) => f.id));
    expect(a.photos.map((p) => p.id)).toEqual(b.photos.map((p) => p.id));
  });

  test("weather keeps the owner's own source label, kind measured", () => {
    const pack = buildDayContext(OWNER, TRIP, "mirador")!;
    const weather = pack.facts.find((f) => f.id === "weather")!;
    expect(weather.kind).toBe("measured");
    expect(weather.attrs?.source).toBe("the hotel's own thermometer");
  });

  test("costs are included because the notes mention money", () => {
    const pack = buildDayContext(OWNER, TRIP, "mirador")!;
    expect(pack.facts.some((f) => f.id === "cost1" && f.text.includes("18 EUR"))).toBe(true);
  });

  test("a day with no money mentioned and includeCosts unset carries no cost fact", () => {
    const pack = buildDayContext(OWNER, TRIP, "departure")!;
    expect(pack.facts.some((f) => f.id.startsWith("cost"))).toBe(false);
  });

  test("a photograph carries its owner caption and its AI-seen description as separate items", () => {
    const pack = buildDayContext(OWNER, TRIP, "mirador")!;
    const seen = pack.photos.find((p) => p.kind === "seen")!;
    expect(seen.text).toBe("steam over an outdoor pool near the castle wall");
    expect(seen.attrs?.camera_time).toBe("09:31");
    const owner = pack.photos.find((p) => p.kind === "owner")!;
    expect(owner.text).toBe("the owner's own caption");
  });

  test("neighbours carry the previous and next day", () => {
    const pack = buildDayContext(OWNER, TRIP, "mirador")!;
    const prev = pack.neighbours.find((n) => n.id === "prev")!;
    expect(prev.text).toContain("2026-05-01");
    expect(prev.text).toContain("Home"); // the arrival day is at home
    const next = pack.neighbours.find((n) => n.id === "next")!;
    expect(next.text).toContain("2026-05-03");
  });

  test("voice samples never include a test day or a draft", () => {
    const pack = buildDayContext(OWNER, TRIP, "mirador", { voiceSamples: 5 })!;
    const texts = pack.voiceSamples.map((v) => v.text).join(" ");
    expect(texts).not.toContain("Not real, just proving");
    expect(texts).not.toContain("Never published");
  });

  test("voice samples never include the day itself", () => {
    const pack = buildDayContext(OWNER, TRIP, "mirador", { voiceSamples: 10 })!;
    expect(pack.voiceSamples.some((v) => v.text.includes("funicular"))).toBe(false);
  });

  test("an unknown day is null, not a throw", () => {
    expect(buildDayContext(OWNER, TRIP, "no-such-day")).toBeNull();
  });
});

describe("renderDayPack / packText / allowedText", () => {
  test("renders no email, no coordinate, no filename", () => {
    const pack = buildDayContext(OWNER, TRIP, "mirador", { voiceSamples: 2 })!;
    const xml = renderDayPack(pack);
    expect(xml).not.toContain("@");
    expect(xml).not.toContain(String(LISBON.lat));
    expect(xml).not.toContain(String(LISBON.lng));
    expect(xml).not.toContain(".jpg");
    expect(xml).not.toContain(".heic");
    expect(xml).toContain("<day_pack>");
    expect(xml).toContain("steam over an outdoor pool");
  });

  test("escapes <, > and &", () => {
    const pack = buildDayContext(OWNER, TRIP, "mirador")!;
    pack.facts.push({ id: "weird", kind: "owner", text: "Rock & roll <loud>" });
    const xml = renderDayPack(pack);
    expect(xml).toContain("Rock &amp; roll &lt;loud&gt;");
    expect(xml).not.toContain("<loud>");
  });

  test("packText lists every item with a stable id and kind", () => {
    const pack = buildDayContext(OWNER, TRIP, "mirador")!;
    const items = packText(pack);
    expect(items.find((i) => i.id === "place")?.kind).toBe("owner");
    expect(items.find((i) => i.id === "weather")?.kind).toBe("measured");
  });

  test("allowedText carries owner/measured text but not what the AI saw", () => {
    const pack = buildDayContext(OWNER, TRIP, "mirador")!;
    const allowed = allowedText(pack);
    const seen = seenText(pack);
    expect(allowed).toContain("Lisbon");
    expect(allowed).not.toContain("steam over an outdoor pool");
    expect(seen).toContain("steam over an outdoor pool");
  });
});

describe("one part of a day (persona round, 2 Oct)", () => {
  test("another part of the same date never becomes this part's notes", async () => {
    writeDayFixture(dir, OWNER, TRIP, {
      slug: "mirador-evening",
      date: "2026-05-02",
      time: "19:00",
      location: "Lisbon",
      country: "Portugal",
      coordinates: LISBON,
      content: "Fado in a tiny bar, someone else's evening.",
    });
    const { buildDayContext } = await import("@/lib/helper/dayContext");
    const pack = buildDayContext(OWNER, TRIP, "mirador")!;
    const notes = pack.notes.map((n) => n.text).join(" ");
    expect(notes).toContain("mirador");
    expect(notes).not.toContain("Fado");
  });
});
