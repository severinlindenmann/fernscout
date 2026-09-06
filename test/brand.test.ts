import { describe, expect, it } from "vitest";
import { contrast, GROUNDS, lockup, lockups, palette, verdict } from "@/lib/brand";

/**
 * The bench at `/docs/branding/identity` is only worth trusting if what it
 * derives is right, and "right" here is checkable: WCAG publishes the two
 * anchors, and the palette either parses out of the stylesheet or does not.
 */
describe("brand", () => {
  it("computes the two ratios WCAG defines exactly", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    // Order must not matter — the page asks in whichever order reads better.
    expect(contrast("#1e293b", "#fffaf0")).toBeCloseTo(contrast("#fffaf0", "#1e293b"), 10);
  });

  it("reads the palette out of the stylesheet, not out of a second list", () => {
    const swatches = palette();
    const hex = Object.fromEntries(swatches.map((s) => [s.token, s.hex]));
    expect(hex["yellow-400"]).toBe("#ffd23f");
    expect(hex["navy-900"]).toBe("#1e293b");
    // Every ground text is set on has to exist, or the table has a blank column.
    for (const ground of GROUNDS) expect(hex[ground]).toMatch(/^#[0-9a-f]{6}$/);
    // The `@theme` re-export is `var(--color-…)`, and must not double every row.
    expect(new Set(swatches.map((s) => s.token)).size).toBe(swatches.length);
  });

  it("keeps the two traps trapped", () => {
    const hex = Object.fromEntries(palette().map((s) => [s.token, s.hex]));
    // Both name-suggests-otherwise fill colours, the reason the page exists.
    expect(verdict(contrast(hex["yellow-600"], hex["cream-50"]))).toBe("fill only");
    expect(verdict(contrast(hex["green-500"], hex["cream-50"]))).toBe("fill only");
    // And the colours that replace them.
    expect(verdict(contrast(hex["green-700"], hex["cream-50"]))).toBe("AA");
    expect(verdict(contrast(hex["navy-900"], hex["yellow-400"]))).toBe("AAA");
  });

  it("reads the lockups out of the manual, and every one of them exists", () => {
    const found = lockups();
    expect(found.length).toBeGreaterThan(3);
    // The derived PNG is in the same table and is not a source.
    expect(found.map((l) => l.file)).not.toContain("fernscout-avatar-640.png");
    for (const { file, slot } of found) {
      expect(lockup(file)).toContain("<svg");
      expect(slot).not.toBe("");
    }
  });
});
