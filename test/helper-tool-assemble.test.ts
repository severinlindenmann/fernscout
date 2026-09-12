import { afterEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { runTool } from "@/lib/helper/tools";
import { writeDayReadiness } from "@/lib/dayReadiness";
import { storeInboxFile } from "@/lib/inbox";
import type { Say } from "@/lib/helper/intents";

/**
 * `assemble_day` — Phase 3's own front door onto a date already staged in its
 * folder. `propose()` is driven directly, the same way
 * `test/helper-start-day-press.test.ts` drives `start_day`'s — no route, no
 * database, since nothing here writes.
 */

const USERNAME = "us";
const TRIP = "reise";

function journal(features: Record<string, boolean> = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "helper-assemble-"));
  const featureBlock = Object.fromEntries(Object.entries(features).map(([k, v]) => [k, { enabled: v }]));
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "F", url: "https://example.test", defaultUser: USERNAME },
      users: { reserved: [] },
      features: featureBlock,
    }),
  );
  fs.mkdirSync(path.join(dir, USERNAME, "trips", TRIP, "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, USERNAME, "config.json"),
    JSON.stringify({
      title: "F",
      tagline: "t",
      owner: { name: "A B", nickname: "A" },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      features: featureBlock,
    }),
  );
  fs.writeFileSync(
    path.join(dir, USERNAME, "trips", TRIP, "trip.md"),
    ["---", `id: ${TRIP}`, 'title: "Die Reise"', 'start: "2026-05-01"', 'end: "2026-05-10"', "---", "", "Intro.", ""].join(
      "\n",
    ),
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

const say: Say = ((key: string, vars?: Record<string, string>) =>
  vars ? `${key} ${Object.values(vars).join(" ")}` : key) as Say;

describe("assemble_day", () => {
  test("a date with nothing missing proposes creating the day", async () => {
    journal();
    // Everything a trip that tracks costs+coordinates would still ask about
    // is answered: costs declined, and a location on file for coordinates.
    // Photos are a `publish` row and are never owed here.
    writeDayReadiness(USERNAME, "2026-05-04", {
      without: ["costs"],
      location: { lat: 1, lon: 2, source: "browser" },
    });
    const ran = await runTool(USERNAME, "assemble_day", { trip: TRIP, date: "2026-05-04" }, say, "2026-05-06");
    expect(ran.proposal).toBeTruthy();
    const fields = ran.proposal?.fields ?? [];
    expect(fields.map((f) => f.name).sort()).toEqual(["date", "trip"]);
    expect(ran.proposal?.arguments.date).toBe("2026-05-04");
  });

  test("a date missing costs and weather asks about both in one sentence", async () => {
    journal({ weather: true });
    writeDayReadiness(USERNAME, "2026-05-04", { location: { lat: 1, lon: 2, source: "browser" } });
    const ran = await runTool(USERNAME, "assemble_day", { trip: TRIP, date: "2026-05-04" }, say, "2026-05-06");
    const fields = (ran.proposal?.fields ?? []).map((f) => f.name);
    expect(fields).toContain("costs");
    expect(fields).toContain("weather");
  });

  test("a field already declined is never asked again, even with other fields still missing", async () => {
    journal();
    writeDayReadiness(USERNAME, "2026-05-04", { without: ["costs"] });
    const ran = await runTool(USERNAME, "assemble_day", { trip: TRIP, date: "2026-05-04" }, say, "2026-05-06");
    const fields = (ran.proposal?.fields ?? []).map((f) => f.name);
    expect(fields).not.toContain("costs");
    expect(fields).toContain("coordinates");
  });

  test("undated content implying more than one day asks which, before anything else", async () => {
    journal();
    const { entry: a } = storeInboxFile(USERNAME, "media", "a.jpg", Buffer.from("a"), {
      takenAt: "2026-05-01T10:00:00Z",
    });
    const { entry: b } = storeInboxFile(USERNAME, "media", "b.jpg", Buffer.from("b"), {
      takenAt: "2026-05-03T10:00:00Z",
    });
    void a;
    void b;
    const ran = await runTool(USERNAME, "assemble_day", { trip: TRIP }, say, "2026-05-06");
    const dateField = (ran.proposal?.fields ?? []).find((f) => f.name === "date");
    expect(dateField?.options?.map((o) => o.value).sort()).toEqual(["2026-05-01", "2026-05-03"]);
  });
});
