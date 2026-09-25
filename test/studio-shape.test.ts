import fs from "node:fs";
import path from "node:path";
import { routeImplementation } from "./support/openCore";
import { describe, expect, test } from "vitest";
import { STUDIO_GROUPS } from "@/lib/studio/groups";

/**
 * The studio's shape keeper — B2062.
 *
 * Every page under app/[user]/studio/ (found on disk, never listed here)
 * renders through `components/studio/StudioPage.tsx`, which owns the frame,
 * the one text-2xl h1 and the crumb back to the studio. A page's source is
 * read together with the files it imports one level down (`@/components/…`
 * and `./…`), so a page that delegates to a content component is judged by
 * what it actually draws.
 *
 * The W3 migration (B2068) emptied B2062's `NOT_YET_ON_SHELL` allow-list:
 * every page is on the shell now, and a new page joins it by being written
 * that way. What remains is `WIDER` — the pages whose StudioPage width is not
 * "flow", each with the reason its content needs the room. It may only
 * shrink or be argued for; a stale entry fails below.
 */
const WIDER: Record<string, { width: "board" | "wide"; reason: string }> = {
  "inbox/page.tsx": { width: "board", reason: "a grid of uploaded files, several tiles a row" },
  "photobook/page.tsx": { width: "board", reason: "the trip chooser's cards read as a board of books, not a form" },
  "visitors/page.tsx": { width: "wide", reason: "a chart: a bar per day over up to 90 days" },
  "readers/page.tsx": { width: "board", reason: "the two doors side by side, then a card per person (B2291)" },
};

/** The hub is the studio itself: it has no way back to itself and is not a
 * subpage. B2063-onward rebuild it as the Desk. */
const THE_HUB = "page.tsx";

/** The hub's own width and its reason — B2134. Outside WIDER because the walk
 * below skips the hub; held to the same rule: a width, and why. */
const HUB_WIDTH = {
  width: "wide",
  reason: "six group cards three abreast at desktop, so a row's chips stay on its title's line",
} as const;

const ROOT = path.join(process.cwd(), "app", "[user]", "studio");

function pages(dir = ROOT): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return pages(full);
    return e.name === "page.tsx" ? [path.relative(ROOT, full).split(path.sep).join("/")] : [];
  });
}

function resolve(spec: string, from: string): string | null {
  const base = spec.startsWith("@/") ? path.join(process.cwd(), spec.slice(2)) : path.resolve(path.dirname(from), spec);
  for (const ext of [".tsx", ".ts", "/index.tsx"]) if (fs.existsSync(base + ext)) return base + ext;
  return null;
}

/** The shell and the site header are the frame itself, not the page's own
 * drawing — their classes would otherwise count against every page. */
const CHROME = [path.join("components", "studio", "StudioPage.tsx"), path.join("components", "PageHeader.tsx")];

/** The page plus every `@/components/…` or `./…` file it imports, one level. */
function sourceOf(rel: string): string {
  const file = routeImplementation(path.join(ROOT, rel)) ?? path.join(ROOT, rel);
  const own = fs.readFileSync(file, "utf8");
  const imported = [...own.matchAll(/from "((?:@\/components\/|\.\/)[^"]+)"/g)]
    .map((m) => resolve(m[1], file))
    .filter((f): f is string => f !== null && !CHROME.some((c) => f.endsWith(c)))
    .map((f) => fs.readFileSync(f, "utf8"));
  return [own, ...imported].join("\n");
}

/** A page that only redirects draws nothing (the retired trip/rename, B2072). */
const redirectsOnly = (p: string) => {
  const src = fs.readFileSync(path.join(ROOT, p), "utf8");
  return /\bpermanentRedirect\(/.test(src) && !/<[A-Za-z]/.test(src);
};

const inThisBuild = (p: string) => routeImplementation(path.join(ROOT, p)) !== null;
const ALL = pages().filter((p) => p !== THE_HUB && !redirectsOnly(p) && inThisBuild(p));
const ON_SHELL = ALL;

/** Every group id a page may pass — `lib/studio/groups.ts`'s own list. */
const GROUPS = new RegExp(`group[=:]\\s*"(${STUDIO_GROUPS.join("|")})"`);
const WIDTH_BOARD_OR_WIDE = /width[=:]\s*"(board|wide)"/;

describe("studio pages keep the studio's shape", () => {
  test("the walk finds the pages", () => {
    expect(ALL.length).toBeGreaterThan(10);
  });

  test("every WIDER entry is a real page that asks for exactly that width, with a reason", () => {
    for (const [page, { width, reason }] of Object.entries(WIDER)) {
      if (fs.existsSync(path.join(ROOT, page)) && !inThisBuild(page)) continue;
      expect(ALL, `${page} is in WIDER but no such page exists`).toContain(page);
      expect(reason.trim().length, `${page} needs a reason`).toBeGreaterThan(10);
      expect(sourceOf(page).match(WIDTH_BOARD_OR_WIDE)?.[1], `${page} no longer asks for "${width}"`).toBe(width);
    }
  });

  test("the hub asks for its named width, with a reason", () => {
    const hub = fs.readFileSync(path.join(process.cwd(), "components", "studio", "StudioHub.tsx"), "utf8");
    const widths = [...hub.matchAll(/<StudioPage[^>]*\bwidth="(\w+)"/g)].map((m) => m[1]);
    expect(widths.length).toBeGreaterThan(0);
    expect(new Set(widths)).toEqual(new Set([HUB_WIDTH.width]));
    expect(HUB_WIDTH.reason.length).toBeGreaterThan(10);
  });

  test.each(ON_SHELL)("%s passes its hub group to StudioPage", (page) => {
    expect(sourceOf(page), `${page} must pass one of ${STUDIO_GROUPS.join(", ")}`).toMatch(GROUPS);
  });

  test.each(ON_SHELL)("%s renders through StudioPage", (page) => {
    expect(sourceOf(page)).toMatch(/<StudioPage\b/);
  });

  test.each(ON_SHELL)("%s leaves the h1 to StudioPage", (page) => {
    // Comment lines may still say "the page's own <h1>"; only code counts.
    const code = sourceOf(page)
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(line))
      .join("\n");
    expect(code, "StudioPage renders the one text-2xl h1").not.toMatch(/<h1\b/);
  });

  test.each(ON_SHELL)("%s is no wider than its StudioPage width says", (page) => {
    const src = sourceOf(page);
    if (page in WIDER) return;
    expect(src, `${page} asks for a wider width — name it in WIDER with a reason`).not.toMatch(WIDTH_BOARD_OR_WIDE);
    expect(src).not.toMatch(/\bmax-w-(2xl|3xl|4xl|5xl|6xl|7xl)\b/);
  });

  test.each(ON_SHELL)("%s wears no /me-sized title or gutter", (page) => {
    // /me's signature: a 3xl title growing to 4xl, and a gutter widening at sm and lg.
    expect(sourceOf(page)).not.toMatch(/\bsm:text-4xl\b|\bsm:px-6\b[^"]*\blg:px-8\b/);
  });

  test.each(ALL)("%s has a way back to the studio", (page) => {
    expect(sourceOf(page)).toMatch(/<StudioPage\b|backTo=\{\{\s*href:\s*`\/?\$\{\w+\}\/studio`/);
  });
});
