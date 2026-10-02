import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { getDays } from "@/lib/entries";
import { tripCardSvg } from "@/lib/map/cardSvg";
import { simplifyPath } from "@/lib/mapClip";

vi.mock("@/lib/map/cardCache", () => ({
  readCachedCardSvg: () => null,
  writeCachedCardSvg: () => {},
}));
vi.mock("@/lib/capabilities", () => ({ isEnabled: () => true }));
afterEach(() => vi.unstubAllEnvs());

describe("B2569 Natural Earth underlay on a card", () => {
  test("world-trip-2025 trip card (no street region) stays under 150,000 bytes", async () => {
    vi.stubEnv("CONTENT_DIR", path.join(process.cwd(), "content"));
    const places = getDays("example/world-trip-2025").map(({ date, lead }, i) => ({
      day: i + 1, date, lat: lead.lat, lng: lead.lng, name: lead.location,
    }));
    const card = await tripCardSvg("example", "world-trip-2025", places, [], "light");
    const bytes = Buffer.byteLength(card!.svg, "utf8");
    console.info(`world-trip-2025 trip card: ${bytes} bytes`);
    expect(bytes).toBeLessThan(150_000);
  });

  test("simplifyPath drops sub-tolerance vertices and keeps rings closed", () => {
    expect(simplifyPath("M0,0 L5,0.1 L10,0", 0.5, false)).toBe("M0,0 L10,0");
    expect(simplifyPath("M0,0 L5,0.1 L10,0 L10,10 Z", 0.5, true)).toBe("M0,0 L10,0 L10,10 Z");
    expect(simplifyPath("M0,0 L5,5 L10,0 Z", 0.5, true)).toBe("M0,0 L5,5 L10,0 Z");
    expect(simplifyPath("garbage", 1, true)).toBe("garbage");
  });
});
