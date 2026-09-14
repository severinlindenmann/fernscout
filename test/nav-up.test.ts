import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { upTrail } from "@/lib/navUp";

/**
 * B1728 — the app draws *up*, never *back*.
 *
 * Two halves, and they fail for different reasons. The first is the parent
 * map: `lib/navUp.ts` is the only thing that decides what an ancestor is, so
 * every route's answer is asserted here rather than discovered by clicking.
 * The second is a source scan, because the bug this replaced was not a wrong
 * destination — it was a control with two destinations, chosen at runtime by
 * `router.back()` and a `sessionStorage` flag. A test of the map cannot see
 * that coming back; a scan of the source can.
 */

const USER = "/alex";
/** The current trip's story is `/<user>` itself — see `TripProvider`. */
const CURRENT = "/alex";
const OTHER = "/alex/trips/asia-2023";

describe("the parent of every page inside a journal", () => {
  const cases: [string, string | null, string[]][] = [
    // page                           trip in context   ancestors, nearest first
    ["/alex/trips", CURRENT, ["/"]],
    ["/alex/trips", null, ["/"]],
    ["/alex", CURRENT, ["/alex/trips", "/"]],
    ["/alex/gallery", CURRENT, ["/alex", "/alex/trips", "/"]],
    ["/alex/map", CURRENT, ["/alex", "/alex/trips", "/"]],
    ["/alex/analytics", CURRENT, ["/alex", "/alex/trips", "/"]],
    ["/alex/day/3", CURRENT, ["/alex", "/alex/trips", "/"]],
    ["/alex/costs", CURRENT, ["/alex", "/alex/trips", "/"]],
    ["/alex/weather", CURRENT, ["/alex", "/alex/trips", "/"]],
    [OTHER, OTHER, ["/alex/trips", "/"]],
    [`${OTHER}/gallery`, OTHER, [OTHER, "/alex/trips", "/"]],
    // Journal-level pages belong to the journal, not to whichever trip is
    // current, so they go up to the trip list and skip the story.
    ["/alex/me", null, ["/alex/trips", "/"]],
    ["/alex/search", null, ["/alex/trips", "/"]],
    ["/alex/account", null, ["/alex/trips", "/"]],
    // The trip gate and an invite: same rule, and the reason it matters is
    // that `/alex` is the very trip the gate just refused them.
    ["/alex/i/token", null, ["/alex/trips", "/"]],
  ];

  for (const [pathname, tripBase, expected] of cases) {
    test(`${pathname}${tripBase && tripBase !== CURRENT ? ` (in ${tripBase})` : ""} → ${expected.join(" → ")}`, () => {
      expect(upTrail(pathname, { userBase: USER, tripBase }).map((c) => c.href)).toEqual(expected);
    });
  }

  test("the trip list is not mistaken for a page inside the current trip", () => {
    // `tripBase` is `/alex` for the current trip, and `/alex/trips` is
    // prefixed by it — a plain prefix test would make the list a child of the
    // trip it lists, and its own crumb would then point back at itself.
    const trail = upTrail("/alex/trips", { userBase: USER, tripBase: CURRENT });
    expect(trail).toHaveLength(1);
    expect(trail[0].kind).toBe("root");
  });

  test("a page outside every journal has no ancestors here", () => {
    expect(upTrail("/", { userBase: "", tripBase: null })).toEqual([]);
    expect(upTrail("/docs/hosting", { userBase: "", tripBase: null })).toEqual([]);
    // A journal is in context but the page is not under it — a guard against
    // a stale provider handing the landing page somebody's crumbs.
    expect(upTrail("/agent", { userBase: USER, tripBase: null })).toEqual([]);
  });

  test("no chain is longer than the journal is deep", () => {
    for (const [pathname, tripBase] of cases) {
      expect(upTrail(pathname, { userBase: USER, tripBase }).length).toBeLessThanOrEqual(3);
    }
  });

  test("every crumb is an address, and the last one is always the instance", () => {
    for (const [pathname, tripBase] of cases) {
      const trail = upTrail(pathname, { userBase: USER, tripBase });
      for (const crumb of trail) expect(crumb.href.startsWith("/")).toBe(true);
      expect(trail.at(-1)?.href).toBe("/");
    }
  });
});

/**
 * The source scan. B822 built a back arrow that retraced the browser's own
 * history when a `sessionStorage` flag said the tab had navigated once, and
 * that flag was set on the first soft navigation and never cleared — so the
 * header's breadcrumb, whose only job was to leave the journal, spent the rest
 * of the visit going one page sideways instead. Nothing about that is visible
 * in a rendered page or in a parent map, so this fails the build if
 * history-based navigation returns to the tree.
 */
describe("no control navigates by history", () => {
  const ROOT = process.cwd();
  const DIRS = ["app", "components"];
  /** `router.back`, `history.back`, `history.go(-1)`, `window.history.back`. */
  const HISTORY_NAV = /(?:router|history|window\.history)\s*\.\s*back\s*\(|history\s*\.\s*go\s*\(\s*-/;

  function sources(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...sources(rel));
      else if (/\.tsx?$/.test(entry.name)) out.push(rel);
    }
    return out;
  }

  /**
   * Comments are stripped rather than exempted. Several files explain why the
   * retrace mode was removed and name it to do so, and a scan that reads those
   * sentences as the thing they warn against would make the explanation
   * unwritable.
   */
  function code(file: string): string {
    return fs
      .readFileSync(path.join(ROOT, file), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
  }

  test("nothing in app/ or components/ calls back() or go(-1)", () => {
    const offenders = DIRS.flatMap(sources).filter((file) => HISTORY_NAV.test(code(file)));
    expect(offenders).toEqual([]);
  });

  test("the flag that decided which way the arrow went is gone", () => {
    for (const gone of [
      "components/useBackHistory.ts",
      "components/BackTracker.tsx",
      "components/BackLink.tsx",
    ]) {
      expect(fs.existsSync(path.join(ROOT, gone))).toBe(false);
    }
  });
});
