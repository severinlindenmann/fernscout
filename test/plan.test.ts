import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getPlan } from "@/lib/plan";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";

/**
 * W33 — a future-dated draft becomes a planned stop, merged with plan.md's
 * hand-written route, but only for the owner. Every date below is stamped
 * 2099 or 2020 so "future" and "past" hold regardless of when this runs.
 */

const REF = "p/route-2028";
let dir: string;

function write(rel: string, contents: string) {
  const file = path.join(dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}

function entry(
  file: string,
  data: { date: string; location: string; country: string; lat?: number; lng?: number },
  draft = true,
) {
  const lines = [
    "---",
    `title: "${data.location}"`,
    `date: "${data.date}"`,
    `location: "${data.location}"`,
    `country: "${data.country}"`,
    ...(data.lat !== undefined ? [`lat: ${data.lat}`] : []),
    ...(data.lng !== undefined ? [`lng: ${data.lng}`] : []),
    ...(draft ? ["status: draft"] : []),
    "---",
    "",
    "Notes.",
    "",
  ];
  write(`p/trips/route-2028/entries/${file}`, lines.join("\n"));
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-plan-"));
  process.env.CONTENT_DIR = dir;

  write(
    "config.json",
    JSON.stringify({ site: { name: "T", url: "https://example.test" }, users: {}, features: {} }),
  );
  write(
    "p/config.json",
    JSON.stringify({
      title: "P's journal",
      tagline: "t",
      owner: { name: "P", nickname: "P" },
      startLocation: "X",
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
      features: {},
    }),
  );

  write(
    "p/trips/route-2028/plan.md",
    [
      "---",
      "route:",
      '  - location: "Lisbon"',
      '    country: "Portugal"',
      "    lat: 38.7223",
      "    lng: -9.1393",
      '  - location: "Porto"',
      '    country: "Portugal"',
      "    lat: 41.1579",
      "    lng: -8.6291",
      "---",
      "",
    ].join("\n"),
  );

  // Deduped against the Porto plan.md stop — same coordinates, so it must
  // not draw twice.
  entry("2099-05-01-porto-echo.md", {
    date: "2099-05-01",
    location: "Porto (again)",
    country: "Portugal",
    lat: 41.1579,
    lng: -8.6291,
  });
  // Two genuinely new stops, deliberately written out of date order so the
  // merge — not file order — is what puts Coimbra before Faro.
  entry("2099-06-01-faro.md", {
    date: "2099-06-01",
    location: "Faro",
    country: "Portugal",
    lat: 37.0194,
    lng: -7.9304,
  });
  entry("2099-04-15-coimbra.md", {
    date: "2099-04-15",
    location: "Coimbra",
    country: "Portugal",
    lat: 40.2033,
    lng: -8.4103,
  });
  // No coordinates: a note, not a stop (rule 4 of the spec).
  entry("2099-07-01-no-coords.md", {
    date: "2099-07-01",
    location: "Somewhere undecided",
    country: "Portugal",
  });
  // Already happened — draft or not, it is not "the plan" any more.
  entry("2020-01-01-already-happened.md", {
    date: "2020-01-01",
    location: "Braga",
    country: "Portugal",
    lat: 41.5454,
    lng: -8.4265,
  });
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("getPlan without includeDrafts (a stranger's view)", () => {
  test("shows only plan.md — draft coordinates never leak to a reader", () => {
    const plan = getPlan(REF);
    expect(plan.stops.map((s) => s.location)).toEqual(["Lisbon", "Porto"]);
    expect(plan.stops.every((s) => !s.fromDraft)).toBe(true);
  });
});

describe("getPlan({ includeDrafts: true }) (the owner's view)", () => {
  test("merges future drafts after plan.md, ordered by date, deduped by proximity", () => {
    const plan = getPlan(REF, { includeDrafts: true });
    // Porto's echo draft collapsed into the existing Porto stop; the
    // no-coordinates and already-happened drafts never became stops at all.
    expect(plan.stops.map((s) => s.location)).toEqual(["Lisbon", "Porto", "Coimbra", "Faro"]);
  });

  test("only the draft-derived stops are tagged fromDraft", () => {
    const plan = getPlan(REF, { includeDrafts: true });
    const byLocation = new Map(plan.stops.map((s) => [s.location, s]));
    expect(byLocation.get("Lisbon")?.fromDraft).toBeUndefined();
    expect(byLocation.get("Porto")?.fromDraft).toBeUndefined();
    expect(byLocation.get("Coimbra")?.fromDraft).toBe(true);
    expect(byLocation.get("Faro")?.fromDraft).toBe(true);
  });

  test("a future draft with no coordinates changes nothing", () => {
    const plan = getPlan(REF, { includeDrafts: true });
    expect(plan.stops.map((s) => s.location)).not.toContain("Somewhere undecided");
  });

  test("a past-dated draft is not a plan, even with coordinates", () => {
    const plan = getPlan(REF, { includeDrafts: true });
    expect(plan.stops.map((s) => s.location)).not.toContain("Braga");
  });
});
