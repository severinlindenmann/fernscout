import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { getDays } from "@/lib/entries";
import { dayCardSvg, tripCardSvg } from "@/lib/map/cardSvg";
import { CARD_LIGHT } from "@/lib/map/cardPalette";

// Always render afresh, without writing into the example journal's cache.
vi.mock("@/lib/map/cardCache", () => ({
  readCachedCardSvg: () => null,
  writeCachedCardSvg: () => {},
}));
vi.mock("@/lib/capabilities", () => ({ isEnabled: () => true }));

const MAPS_DIR = "/private/tmp/claude-501/-Users-severin-Documents-GitHub-fernscout/2aa7fa24-22ad-47a5-9077-c1794ab16454/scratchpad/maps";
afterEach(() => vi.unstubAllEnvs());

describe.skipIf(!fs.existsSync(MAPS_DIR) || !fs.statSync(MAPS_DIR).isDirectory())("example street card size budget", () => {
  test.each(["parks-2025", "alps-2024"])("%s stays below 150,000 bytes with roads and water", async (trip) => {
    vi.stubEnv("MAPS_DIR", MAPS_DIR);
    vi.stubEnv("CONTENT_DIR", path.join(process.cwd(), "content"));
    const places = getDays(`example/${trip}`).map(({ date, lead }, i) => ({
      day: i + 1, date, lat: lead.lat, lng: lead.lng, name: lead.location,
    }));
    expect(places.length).toBeGreaterThan(0);
    const card = await tripCardSvg("example", trip, places, [], "light");
    expect(card?.usedStreet).toBe(true);
    const svg = card!.svg;
    const bytes = Buffer.byteLength(svg, "utf8");
    console.info(`${trip}: ${bytes} bytes`);
    expect(svg).toMatch(/<path id="roads" d="M/);
    expect(svg).toContain(`<use href="#roads" fill="none" stroke="${CARD_LIGHT.road}"`);
    expect(svg).toMatch(new RegExp(`<g fill="${CARD_LIGHT.water}" fill-rule="evenodd"><path d="M`));
    expect(bytes).toBeLessThan(150_000);
  });

  test("a day card in the middle of a wide region draws its own streets under budget (world-trip-2025, Kyoto)", async () => {
    vi.stubEnv("MAPS_DIR", MAPS_DIR);
    vi.stubEnv("CONTENT_DIR", path.join(process.cwd(), "content"));
    const places = getDays("example/world-trip-2025").map(({ date, lead }, i) => ({
      day: i + 1, date, lat: lead.lat, lng: lead.lng, name: lead.location,
    }));
    const kyoto = places.find((p) => p.date === "2025-02-14")!;
    const card = await dayCardSvg("example", "world-trip-2025", places, [], kyoto.day, "light");
    expect(card?.usedStreet).toBe(true);
    const bytes = Buffer.byteLength(card!.svg, "utf8");
    console.info(`world-trip-2025 Kyoto day: ${bytes} bytes`);
    expect(bytes).toBeLessThan(150_000);
  });
});
