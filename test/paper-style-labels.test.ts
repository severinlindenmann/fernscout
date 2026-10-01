import { describe, expect, test } from "vitest";
import { paperStyle } from "@/lib/map/paperFlavor";

/**
 * Map labels in the reader's language only (trip-maps plan, "Places and
 * names"): one name per label — the reader's language, then English, then
 * the local name — never the local script as a second line.
 */
describe("paperStyle labels", () => {
  test("every label names the reader's language first, then English, then the local name", () => {
    const style = paperStyle("/api/maps/x.pmtiles", "light", "de-CH");
    const labels = style.layers.filter(
      (l) => l.type === "symbol" && l.layout && "text-field" in (l.layout as object),
    );
    expect(labels.length).toBeGreaterThan(0);
    for (const l of labels) {
      expect((l.layout as Record<string, unknown>)["text-field"]).toEqual([
        "coalesce",
        ["get", "name:de"],
        ["get", "name:en"],
        ["get", "name"],
      ]);
    }
  });
});

// B2624: the style has no sprite, so any `icon-image` logged a MapLibre
// warning on every load and drew nothing.
describe("paperStyle icons", () => {
  test("no layer asks for an icon the style cannot have", () => {
    for (const scheme of ["light", "dark"] as const) {
      const style = paperStyle("/api/maps/x.pmtiles", scheme, "en");
      const withIcon = style.layers.filter((l) => "icon-image" in ((l as { layout?: object }).layout ?? {}));
      expect(withIcon.map((l) => l.id)).toEqual([]);
      expect(style.layers.some((l) => l.id === "places_locality")).toBe(true);
    }
  });
});
