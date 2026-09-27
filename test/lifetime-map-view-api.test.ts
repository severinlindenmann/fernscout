import { describe, expect, test } from "vitest";
import { GET } from "@/app/api/lifetime-map-view/route";

/**
 * B2491's on-demand basemap fetch. Public and unauthenticated — see the
 * route's own block comment for why a frame carries nothing to gate.
 */
describe("GET /api/lifetime-map-view", () => {
  test("returns a basemap for a valid frame", async () => {
    const res = await GET(
      new Request("https://x.test/api/lifetime-map-view?x=500&y=100&w=60&h=40&lngScale=0.7"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { basemap: unknown };
    expect(body).toHaveProperty("basemap");
  });

  test("refuses a non-numeric or missing frame", async () => {
    const res = await GET(new Request("https://x.test/api/lifetime-map-view?x=500&y=100&w=&h=40&lngScale=1"));
    expect(res.status).toBe(400);
  });

  test("refuses a frame larger than the world or far outside it", async () => {
    for (const q of ["x=0&y=0&w=5000&h=40&lngScale=1", "x=-9000&y=0&w=60&h=40&lngScale=1", "x=0&y=0&w=60&h=40&lngScale=3"]) {
      const res = await GET(new Request(`https://x.test/api/lifetime-map-view?${q}`));
      expect(res.status).toBe(400);
    }
  });

  test("refuses a zero-width or negative frame", async () => {
    const res = await GET(
      new Request("https://x.test/api/lifetime-map-view?x=0&y=0&w=0&h=40&lngScale=1"),
    );
    expect(res.status).toBe(400);
  });

  test("sets a public, cacheable response — the same frame always means the same geography", async () => {
    const res = await GET(
      new Request("https://x.test/api/lifetime-map-view?x=500&y=100&w=60&h=40&lngScale=0.7"),
    );
    expect(res.headers.get("cache-control")).toContain("public");
  });
});
