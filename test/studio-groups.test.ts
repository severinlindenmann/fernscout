import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import * as lucide from "lucide-react";
import { GROUP_HUE, STUDIO_GROUPS } from "@/lib/studio/groups";
import { dictionaryFor } from "@/lib/locales";
import { MAINTAINED_LOCALES } from "@/lib/i18n";

/**
 * B2060 — one source for each studio group's hue, icon and label.
 *
 * The hue must be a colour the palette already declares (`--color-*` in
 * app/globals.css, read here rather than listed, so a renamed or removed
 * token fails this test), used only as a fill — GroupMark never sets it as
 * text colour, see test/studio-page.test.tsx.
 */
const CSS = fs.readFileSync(path.join(process.cwd(), "app", "globals.css"), "utf8");
const PALETTE = new Set(
  [...CSS.matchAll(/--color-[a-z]+-\d+:\s*(#[0-9a-fA-F]{6})/g)].map((m) => m[1].toLowerCase()),
);

describe("studio groups", () => {
  test("exactly six groups, each with a hue, icon and label", () => {
    expect(STUDIO_GROUPS).toHaveLength(6);
    expect(Object.keys(GROUP_HUE).sort()).toEqual([...STUDIO_GROUPS].sort());
  });

  test.each(STUDIO_GROUPS)("%s's hue is a declared palette colour", (g) => {
    expect(PALETTE.has(GROUP_HUE[g].hue.toLowerCase()), GROUP_HUE[g].hue).toBe(true);
  });

  test("hues are distinct, so two groups never look alike", () => {
    expect(new Set(STUDIO_GROUPS.map((g) => GROUP_HUE[g].hue)).size).toBe(6);
  });

  test.each(STUDIO_GROUPS)("%s's icon is a lucide icon", (g) => {
    expect(Object.values(lucide)).toContain(GROUP_HUE[g].icon);
  });

  test.each(STUDIO_GROUPS)("%s's label exists in every maintained locale", (g) => {
    for (const locale of MAINTAINED_LOCALES) {
      const raw = JSON.parse(
        fs.readFileSync(path.join(process.cwd(), "site", "locales", `${locale}.json`), "utf8"),
      ) as Record<string, string>;
      expect(raw[GROUP_HUE[g].labelKey], `${locale}: ${GROUP_HUE[g].labelKey}`).toBeTruthy();
    }
    expect(dictionaryFor("en")[GROUP_HUE[g].labelKey]).toBeTruthy();
  });
});
