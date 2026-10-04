// @scans app/at/[user]/studio/**
import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { studioUp } from "@/lib/studio/studioUp";

/**
 * B2853 — every studio page's back goes one level up, read from its own
 * address. The route list is derived from the files, not typed here, so a new
 * studio page cannot ship without a parent.
 */
const ROOT = path.join(process.cwd(), "app", "at", "[user]", "studio");
const ROUTES = (function walk(dir: string, rel: string[] = []): string[][] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) return walk(path.join(dir, e.name), [...rel, e.name]);
    return e.name === "page.tsx" ? [rel] : [];
  });
})(ROOT);

const up = (rest: string, known?: { tripId?: string }) => {
  const [p, qs = ""] = rest.split("?");
  return studioUp("alex", `/@alex/studio${p}`, new URLSearchParams(qs), known);
};

describe("studioUp", () => {
  test("finds the studio routes", () => {
    expect(ROUTES.length).toBeGreaterThan(30);
  });

  test.each(ROUTES.map((r) => [r.join("/") || "(hub)", r] as const))("%s resolves to a parent inside the journal", (_n, segs) => {
    const filled = segs.map((s) => (s.startsWith("[") ? "x1" : s)).join("/");
    const result = up(filled ? `/${filled}` : "");
    expect(result.href).toMatch(/^\/@alex\/(studio|trips\/)/);
    expect(result.labelKey).toBeTruthy();
    // Never up to itself.
    if (filled) expect(result.href).not.toBe(`/@alex/studio/${filled}`);
  });

  test("nested routes go to their URL parent", () => {
    expect(up("/location/japan/2026-03-02")).toEqual({ href: "/@alex/studio/location/japan", labelKey: "studio.up.routes" });
    for (const p of ["/location/japan", "/location/import", "/location/history", "/location/places/new"]) {
      expect(up(p)).toEqual({ href: "/@alex/studio/location", labelKey: "studio.up.routes" });
    }
    expect(up("/trip/roster?trip=japan").href).toBe("/@alex/studio/trip?trip=japan");
  });

  test("a page about one day or trip goes to its reader page", () => {
    expect(up("/day/edit?slug=temples", { tripId: "japan" })).toEqual({ href: "/@alex/trips/japan/day/temples", labelKey: "studio.up.day" });
    expect(up("/day/share?trip=japan&day=2026-03-02-temples").href).toBe("/@alex/trips/japan/day/temples");
    expect(up("/day/publish?trip=japan&day=temples").href).toBe("/@alex/trips/japan/day/temples");
    expect(up("/day/preview?trip=japan&date=2026-03-02")).toEqual({ href: "/@alex/trips/japan", labelKey: "studio.up.trip" });
    expect(up("/trip?trip=japan").href).toBe("/@alex/trips/japan");
    expect(up("/trip/visibility?trip=japan").href).toBe("/@alex/trips/japan");
    expect(up("/plan/japan").href).toBe("/@alex/trips/japan");
  });

  test("pickers, lists and anything without a specific day or trip go to the studio", () => {
    for (const p of ["/day/edit", "/day/publish", "/day/preview", "/trip", "/trip/visibility", "/location", "/people", "/inbox"]) {
      expect(up(p)).toEqual({ href: "/@alex/studio", labelKey: "nav.studio" });
    }
  });
});
