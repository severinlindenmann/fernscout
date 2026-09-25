import { describe, expect, test, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { missingForDayFolder } from "@/lib/dayMissing";
import { ALL_TRACKED } from "@/lib/tracks";
import { storeInboxFile, moveInboxFileToDay } from "@/lib/inbox";
import { writeDayReadiness } from "@/lib/dayReadiness";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";

// "us" rather than "u": USERNAME_RE requires at least two characters, and
// `isEnabled(..., username)` — which the weather tests below exercise —
// calls `getUser()`, which refuses a one-character name outright.
const USERNAME = "us";

function journal(features: Record<string, boolean> = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "day-missing-"));
  const featureBlock = Object.fromEntries(Object.entries(features).map(([k, v]) => [k, { enabled: v }]));
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "F", url: "https://example.test", defaultUser: USERNAME },
      users: { reserved: [] },
      // The server is the ceiling and the journal opts in inside it — both
      // halves have to say yes, see `resolveOne` in lib/capabilities.ts.
      features: featureBlock,
    }),
  );
  fs.mkdirSync(path.join(dir, USERNAME), { recursive: true });
  fs.writeFileSync(
    path.join(dir, USERNAME, "config.json"),
    JSON.stringify({
      title: "F",
      tagline: "t",
      owner: { name: "A B", nickname: "A" },
      startLocation: "X",
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
      features: featureBlock,
    }),
  );
  process.env.CONTENT_DIR = dir;
  clearConfigCache();
  clearUserCache();
  return dir;
}

afterEach(() => {
  delete process.env.CONTENT_DIR;
  clearConfigCache();
  clearUserCache();
});

describe("missingForDayFolder", () => {
  test("an empty date folder, trip tracking everything, owes costs and coordinates but not photos", () => {
    journal();
    const missing = missingForDayFolder(USERNAME, "2026-05-04", ALL_TRACKED);
    const fields = missing.map((m) => m.field);
    expect(fields).toContain("costs");
    expect(fields).toContain("coordinates");
    expect(fields).not.toContain("photos"); // a `publish` row — not owed at creation
  });

  test("a folder with a location item owes nothing for coordinates", () => {
    journal();
    const { entry } = storeInboxFile(USERNAME, "location", "loc.json", Buffer.from("{}"), { lat: 1, lon: 2 });
    moveInboxFileToDay(USERNAME, entry.id, "2026-05-04");
    writeDayReadiness(USERNAME, "2026-05-04", { location: { lat: 1, lon: 2, source: "browser" } });
    const fields = missingForDayFolder(USERNAME, "2026-05-04", ALL_TRACKED).map((m) => m.field);
    expect(fields).not.toContain("coordinates");
  });

  test("a decline already on day.json is never asked again", () => {
    journal();
    writeDayReadiness(USERNAME, "2026-05-04", { without: ["costs"] });
    const fields = missingForDayFolder(USERNAME, "2026-05-04", ALL_TRACKED).map((m) => m.field);
    expect(fields).not.toContain("costs");
  });

  test("a trip that does not track costs never asks about it", () => {
    journal();
    const fields = missingForDayFolder(USERNAME, "2026-05-04", { ...ALL_TRACKED, costs: false }).map((m) => m.field);
    expect(fields).not.toContain("costs");
  });

  test("weather is asked only when a coordinate exists and the capability is on", () => {
    journal({ weather: true });
    let fields = missingForDayFolder(USERNAME, "2026-05-04", ALL_TRACKED).map((m) => m.field);
    expect(fields).not.toContain("weather"); // no coordinate yet

    const { entry } = storeInboxFile(USERNAME, "location", "loc.json", Buffer.from("{}"), { lat: 1, lon: 2 });
    moveInboxFileToDay(USERNAME, entry.id, "2026-05-04");
    writeDayReadiness(USERNAME, "2026-05-04", { location: { lat: 1, lon: 2, source: "browser" } });
    fields = missingForDayFolder(USERNAME, "2026-05-04", ALL_TRACKED).map((m) => m.field);
    expect(fields).toContain("weather");
  });

  test("weather is never asked when the capability is off, even with a coordinate", () => {
    journal();
    const { entry } = storeInboxFile(USERNAME, "location", "loc.json", Buffer.from("{}"), { lat: 1, lon: 2 });
    moveInboxFileToDay(USERNAME, entry.id, "2026-05-04");
    writeDayReadiness(USERNAME, "2026-05-04", { location: { lat: 1, lon: 2, source: "browser" } });
    const fields = missingForDayFolder(USERNAME, "2026-05-04", ALL_TRACKED).map((m) => m.field);
    expect(fields).not.toContain("weather");
  });

  test("weather already asked (declined or answered) is never asked again", () => {
    journal({ weather: true });
    const { entry } = storeInboxFile(USERNAME, "location", "loc.json", Buffer.from("{}"), { lat: 1, lon: 2 });
    moveInboxFileToDay(USERNAME, entry.id, "2026-05-04");
    writeDayReadiness(USERNAME, "2026-05-04", {
      location: { lat: 1, lon: 2, source: "browser" },
      weatherAsked: true,
    });
    const fields = missingForDayFolder(USERNAME, "2026-05-04", ALL_TRACKED).map((m) => m.field);
    expect(fields).not.toContain("weather");
  });

  test("one entry per photo still missing a caption, none for a photo already asked or already captioned", () => {
    journal();
    const { entry: a } = storeInboxFile(USERNAME, "media", "a.jpg", Buffer.from("a"), {});
    const { entry: b } = storeInboxFile(USERNAME, "media", "b.jpg", Buffer.from("b"), { caption: "the harbour" });
    const { entry: c } = storeInboxFile(USERNAME, "media", "c.jpg", Buffer.from("c"), { descriptionAsked: true });
    for (const e of [a, b, c]) moveInboxFileToDay(USERNAME, e.id, "2026-05-04");
    const captions = missingForDayFolder(USERNAME, "2026-05-04", ALL_TRACKED).filter((m) => m.field === "caption");
    expect(captions).toHaveLength(1);
    expect((captions[0] as { photoId: string }).photoId).toBe(a.id);
  });
});
