import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import MiniSearch from "minisearch";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { clearConfigCache } from "@/lib/config";
import { SEARCH_QUERY, type SearchDoc } from "@/lib/searchOptions";
import { clearUserCache } from "@/lib/users";

/**
 * B974 — what the top result is, for the words people actually type.
 *
 * Found by loading the deployed index into MiniSearch and asking it in
 * German: "Preis" answered with four Analytics rows before the costs page,
 * because both vocabularies carried the money words and only one of them had
 * a page for them; "Bilder" answered with a documentation page, because
 * Gallery, Map and Story had no synonyms at all.
 *
 * Searched here exactly as `components/SearchBox.tsx` searches, options and
 * boosts included — a ranking assertion made with different options is an
 * assertion about nothing.
 */
vi.mock("@/lib/capabilities", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/capabilities")>();
  return { ...actual, isEnabled: () => true };
});

const USER = "reisende";
let index: MiniSearch<SearchDoc>;
let dir = "";

function top(query: string): { title: string; url: string; kind: string }[] {
  return index
    .search(query, SEARCH_QUERY)
    .map((hit) => ({
      title: hit.title as string,
      url: hit.url as string,
      kind: hit.kind as string,
    }));
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-search-rank-"));
  process.env.CONTENT_DIR = dir;
  clearConfigCache();
  clearUserCache();
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ site: { name: "T", url: "https://t.test", defaultUser: USER } }),
  );
  const trip = path.join(dir, USER, "trips", "alpen-2026");
  fs.mkdirSync(path.join(trip, "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, USER, "config.json"),
    JSON.stringify({
      title: "Unsere Reisen",
      owner: { name: "R T", nickname: "R", email: "r@example.test" },
      defaultLocale: "de",
      locales: ["de"],
      baseCurrency: "CHF",
    }),
  );
  fs.writeFileSync(
    path.join(trip, "trip.md"),
    [
      "---",
      "id: alpen-2026",
      'title: "Vier Tage in den Alpen"',
      'start: "2026-08-24"',
      'end: "2026-08-27"',
      "status: past",
      "visibility: public",
      "---",
      "",
      "Eine Runde durch die Alpen.",
    ].join("\n"),
  );
  // Enough to make the costs page real — `hasCostsData` reads this file.
  fs.writeFileSync(
    path.join(trip, "costs.md"),
    ["---", "budget: 1000", "---", "", "Was die Reise gekostet hat."].join("\n"),
  );
  fs.writeFileSync(
    path.join(trip, "entries", "2026-08-25-tag.md"),
    [
      "---",
      'title: "Ein Tag"',
      'date: "2026-08-25"',
      'location: "Bellinzona"',
      'country: "Schweiz"',
      "status: published",
      "---",
      "",
      "Es ist etwas passiert.",
    ].join("\n"),
  );

  const { buildSearchIndex } = await import("@/lib/search");
  index = buildSearchIndex(USER)!;
});

afterAll(() => {
  delete process.env.CONTENT_DIR;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("what a German reader gets for the words they type", () => {
  test("Preis lands on the costs page, not on the hub above it", () => {
    expect(top("Preis")[0].url).toBe(`/${USER}/costs`);
  });

  test("Kosten does too", () => {
    expect(top("Kosten")[0].url).toBe(`/${USER}/costs`);
  });

  test("Bilder and Fotos reach the gallery — B974's second fault", () => {
    expect(top("Bilder")[0].url).toBe(`/${USER}/gallery`);
    expect(top("Fotos")[0].url).toBe(`/${USER}/gallery`);
  });

  test("Route reaches the map", () => {
    expect(top("Route")[0].url).toBe(`/${USER}/map`);
  });

  test("Hilfe reaches a guide, which is what is written for a person", () => {
    expect(top("Hilfe")[0].url).toMatch(/^\/docs\/guide\//);
  });

  test("Dokumentation still reaches the documentation", () => {
    expect(top("Dokumentation")[0].url).toMatch(/^\/docs/);
  });
});
