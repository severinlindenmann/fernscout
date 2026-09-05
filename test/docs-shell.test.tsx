import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * B470 — every docs page is wrapped by one shell.
 *
 * The complaint that produced this ticket was that /docs had no way back to
 * the site and two different menus. Both were structural: there was no docs
 * layout at all, so each page built its own header and the guides brought
 * their own switcher. These assertions are on the source rather than on a
 * render, because what matters is that exactly one component owns each of
 * those jobs.
 */
function read(file: string): string {
  return fs.readFileSync(path.join(process.cwd(), file), "utf8");
}

describe("the docs shell", () => {
  test("a layout exists and links back to the site", () => {
    const layout = read("app/docs/layout.tsx");
    expect(layout).toContain('href="/"');
    expect(layout).toContain("docs.backToSite");
  });

  test("the shell owns the only language switcher", () => {
    expect(read("app/docs/layout.tsx")).toContain("LocaleSwitcher");
    // No page under /docs brings its own; that is what made the guides' one
    // read as part of the guides rather than part of the site.
    for (const file of [
      "app/docs/page.tsx",
      "app/docs/api/page.tsx",
      "app/docs/guide/[guide]/page.tsx",
    ]) {
      expect(read(file), file).not.toContain("LocaleSwitcher");
    }
  });
});
