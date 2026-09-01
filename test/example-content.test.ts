import { beforeEach, describe, expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";
import { getTrips, getTrip, tripDir } from "@/lib/trips";
import { getAllEntries, getDays } from "@/lib/entries";
import { getPlan } from "@/lib/plan";
import { getBudgetInBase, getCostSummary, COST_CATEGORIES } from "@/lib/costs";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";

/**
 * content/example/ is the only place every field is exercised at once, and
 * that is a job it can only do while somebody is checking.
 *
 * A field nothing in the demo set uses is a field whose breakage nobody sees:
 * the trip countdown asked for a budget by bare id rather than by ref for
 * months, and it went unnoticed precisely because the demo had no `upcoming`
 * trip to draw a countdown for. These tests are the tripwire for that — not
 * assertions about prose, which is free to change, but about which shapes are
 * still represented.
 *
 * The generator is scripts/build-demo-content.mjs. If one of these fails, add
 * the missing shape there and re-run it rather than editing content by hand.
 */

const REF_PREFIX = "example/";

beforeEach(() => {
  process.env.CONTENT_DIR = path.join(process.cwd(), "content");
  clearConfigCache();
  clearUserCache();
});

const trips = () => getTrips("example");
const everyEntry = () =>
  trips().flatMap((t) => getAllEntries(t.ref, { includeDrafts: true }));

describe("the demo journal covers every trip shape", () => {
  test("all three statuses are represented", () => {
    expect(new Set(trips().map((t) => t.status))).toEqual(
      new Set(["past", "current", "upcoming"]),
    );
  });

  test("exactly one trip is current", () => {
    expect(trips().filter((t) => t.status === "current")).toHaveLength(1);
  });

  test("every accent is used, so the lifetime map's legend is legible", () => {
    // Two trips sharing a hue makes the legend say nothing.
    const accents = trips().map((t) => t.accent);
    expect(new Set(accents).size).toBe(accents.length);
    expect(new Set(accents)).toEqual(
      new Set(["sky", "yellow", "green", "coral", "navy"]),
    );
  });

  test("a trip names the people who took it, with a nickname", () => {
    const shared = trips().filter((t) => t.people.length > 1);
    expect(shared.length).toBeGreaterThan(0);
    expect(shared.some((t) => t.people.some((p) => p.nickname))).toBe(true);
  });

  test("a trip carries a translated title and tagline", () => {
    const translated = trips().filter((t) => t.translations?.de?.title);
    expect(translated.length).toBeGreaterThan(0);
    expect(translated.some((t) => t.translations?.hu?.tagline)).toBe(true);
  });

  test("covers point at media that is actually on disk", () => {
    const withCover = trips().filter((t) => t.cover);
    expect(withCover.length).toBeGreaterThan(0);
    for (const trip of withCover) {
      // Prefixed with the owner on read; trip-relative on disk.
      expect(trip.cover).toMatch(/^\/example\/media\//);
      const rel = trip.cover!.replace(`/example/media/${trip.id}/`, "");
      expect(
        fs.existsSync(path.join(tripDir(trip.ref), "media", rel)),
        `${trip.id} cover ${trip.cover} is not on disk`,
      ).toBe(true);
    }
  });
});

describe("the upcoming trip renders as a countdown", () => {
  const upcoming = () => trips().find((t) => t.status === "upcoming")!;

  test("it exists and has no entries a reader can see", () => {
    expect(upcoming()).toBeDefined();
    expect(getAllEntries(upcoming().ref)).toHaveLength(0);
  });

  test("its budget resolves — the countdown has a figure to show", () => {
    // This is the regression: the page passed `trip.id` where a
    // `<user>/<trip>` ref was wanted, so the budget silently vanished.
    const budget = getBudgetInBase(upcoming().ref);
    expect(budget?.total).toBeGreaterThan(0);
    expect(budget?.days).toBeGreaterThan(0);
  });

  test("its planned route is drawn, and the stops carry notes", () => {
    const plan = getPlan(upcoming().ref);
    expect(plan.stops.length).toBeGreaterThan(1);
    expect(plan.stops.filter((s) => s.note).length).toBeGreaterThan(0);
    // Nothing has happened yet.
    expect(plan.reachedCount).toBe(0);
  });

  test("future-dated drafts extend the route, but only for the owner", () => {
    const ref = upcoming().ref;
    const stranger = getPlan(ref).stops;
    const owner = getPlan(ref, { includeDrafts: true }).stops;
    expect(owner.length).toBeGreaterThan(stranger.length);
    expect(owner.filter((s) => s.fromDraft).length).toBeGreaterThan(0);
    expect(stranger.some((s) => s.fromDraft)).toBe(false);
  });
});

describe("the demo journal covers every entry shape", () => {
  test("one day holds several updates, ordered by time", () => {
    const multi = trips()
      .flatMap((t) => getDays(t.ref))
      .filter((d) => d.entries.length > 1);
    expect(multi.length).toBeGreaterThan(0);
    for (const day of multi) {
      const times = day.entries.map((e) => e.time ?? "");
      expect(times).toEqual([...times].sort());
      // The day's arrival leg belongs to the lead, not to the afterthought.
      expect(day.lead).toBe(day.entries[0]);
    }
  });

  test("every entry is tagged", () => {
    for (const entry of everyEntry()) {
      expect(entry.tags.length, `${entry.slug} has no tags`).toBeGreaterThan(0);
      for (const tag of entry.tags) expect(tag).toMatch(/^[a-z0-9][a-z0-9-]*$/);
    }
  });

  test("the clip has a poster, so the grid does not download the video", () => {
    const videos = everyEntry().flatMap((e) =>
      e.gallery.filter((g) => g.type === "video"),
    );
    expect(videos.length).toBeGreaterThan(0);
    for (const video of videos) {
      expect(video.poster).toMatch(/^\/example\/media\//);
    }
  });

  test("entries are translated into every locale the journal advertises", () => {
    const declared: string[] = JSON.parse(
      fs.readFileSync(
        path.join(process.cwd(), "content", "example", "config.json"),
        "utf8",
      ),
    ).locales;
    const written = new Set(
      everyEntry().flatMap((e) => Object.keys(e.translations ?? {})),
    );
    for (const locale of declared.filter((l) => l !== "en")) {
      expect(written.has(locale), `nothing is translated into ${locale}`).toBe(true);
    }
  });

  test("a translation may override the title as well as the prose", () => {
    const titled = everyEntry().filter((e) =>
      Object.values(e.translations ?? {}).some((t) => t.title),
    );
    expect(titled.length).toBeGreaterThan(0);
  });

  test("drafts exist, and no reading path shows them", () => {
    for (const trip of trips()) {
      const all = getAllEntries(trip.ref, { includeDrafts: true });
      expect(getAllEntries(trip.ref).some((e) => e.draft)).toBe(false);
      expect(all.length).toBeGreaterThanOrEqual(getAllEntries(trip.ref).length);
    }
    expect(everyEntry().some((e) => e.draft)).toBe(true);
  });
});

describe("the demo journal covers every cost shape", () => {
  test("every category the chart can draw is spent in somewhere", () => {
    const used = new Set(
      trips().flatMap((t) => getCostSummary(t.ref).items.map((i) => i.category)),
    );
    for (const category of COST_CATEGORIES) {
      expect(used.has(category), `nothing is filed under "${category}"`).toBe(true);
    }
  });

  test("every trip's spend converts, in every currency it was spent in", () => {
    for (const trip of trips()) {
      const summary = getCostSummary(trip.ref);
      expect(
        summary.unconverted,
        `${trip.ref} has amounts it could not convert`,
      ).toEqual([]);
      expect(summary.budget?.total).toBeGreaterThan(0);
    }
  });

  test("a preparation cost is spent in a foreign currency somewhere", () => {
    // Preparation is not always paid at home, and the trip's own rate is what
    // converts it — a path nothing exercised while every prep line was in CHF.
    const foreign = trips().flatMap((trip) =>
      getCostSummary(trip.ref).items.filter(
        (i) => i.category !== "food" && i.currency !== "CHF",
      ),
    );
    expect(foreign.length).toBeGreaterThan(0);
  });
});

describe("the demo journal is addressable", () => {
  test("every trip resolves by its ref", () => {
    for (const trip of trips()) {
      expect(getTrip(REF_PREFIX + trip.id)?.ref).toBe(trip.ref);
    }
  });
});
