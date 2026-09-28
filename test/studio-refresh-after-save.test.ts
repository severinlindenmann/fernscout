import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

/**
 * B2549 — a studio flow that saves with `fetch` and never tells the router
 * leaves the page it returns to showing what it had before the save. Every
 * mutating `fetch(...)` call (a POST/PUT/PATCH/DELETE) in a client file
 * under `components/studio/`, `app/at/[user]/studio/` and the day/readers
 * components the studio uses must be followed, within the same function, by
 * `router.refresh()`, a full document load (`window.location...`), or an
 * explicit `// no-refresh: <reason>` comment for the rare case a refresh
 * would be wrong (an in-flight autosave clobbering what the person is still
 * typing, say).
 *
 * Checked per call site, not per file: a file with one deliberate full-load
 * elsewhere (an offline fallback, a sign-out) must not let that excuse a
 * second, unrelated save nearby that never tells the router anything.
 *
 * Found on disk, never hand-listed — a curated list goes stale the next time
 * a flow is added or renamed.
 */
const ROOTS = [
  path.join(process.cwd(), "components", "studio"),
  path.join(process.cwd(), "app", "at", "[user]", "studio"),
  path.join(process.cwd(), "components", "DeleteDay.tsx"),
  path.join(process.cwd(), "components", "DayNotify.tsx"),
];

function tsxFiles(root: string): string[] {
  const stat = fs.statSync(root, { throwIfNoEntry: false });
  if (!stat) return [];
  if (stat.isFile()) return root.endsWith(".tsx") || root.endsWith(".ts") ? [root] : [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(root, e.name);
    if (e.isDirectory()) return tsxFiles(full);
    return /\.tsx?$/.test(e.name) ? [full] : [];
  });
}

const FILES = ROOTS.flatMap(tsxFiles);

/** How far past (and, for a `// no-refresh:` comment written just above the
 *  call rather than after its success branch, before) a mutating
 *  `fetch(...)` call to look for evidence it tells the router something —
 *  far enough to cover the rest of a typical async handler (the success
 *  branch, `finally`, and a line or two after), not so far that it reaches
 *  into an unrelated function below it. */
const LOOKAHEAD = 2200;
const LOOKBEHIND = 300;

const EVIDENCE_BASE = /\brouter\.refresh\(\)|\bwindow\.location\.(assign|reload|href)\b|location\.href\s*=|\/\/\s*no-refresh:\s*\S/;

/** A file sometimes wraps `router.refresh()` in its own locally named
 *  function (`function refresh() { router.refresh(); }`, ReadersAdmin's own
 *  shape) so several call sites can share one line of intent. When a file
 *  does that, a call to that same name also counts as evidence. */
function evidenceFor(src: string): RegExp {
  const wrapper = /\bfunction\s+(\w+)\s*\([^)]*\)\s*\{[^}]*\brouter\.refresh\(\)/.exec(src);
  if (!wrapper) return EVIDENCE_BASE;
  const name = wrapper[1];
  return new RegExp(`${EVIDENCE_BASE.source}|\\b${name}\\(`);
}

/** Every mutating fetch call's offset and line number in `src`. */
function mutatingFetchSites(src: string): { offset: number; line: number }[] {
  const re = /fetch\([\s\S]{0,400}?method:\s*["'](POST|PUT|PATCH|DELETE)["']/g;
  const sites: { offset: number; line: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const line = src.slice(0, m.index).split("\n").length;
    sites.push({ offset: m.index, line });
  }
  return sites;
}

function unaddressedSites(src: string): number[] {
  const evidence = evidenceFor(src);
  return mutatingFetchSites(src)
    .filter(({ offset }) => !evidence.test(src.slice(Math.max(0, offset - LOOKBEHIND), offset + LOOKAHEAD)))
    .map(({ line }) => line);
}

describe("studio saves tell the router", () => {
  test("the walk finds studio files", () => {
    expect(FILES.length).toBeGreaterThan(20);
  });

  const withMutatingFetch = FILES.filter((f) => mutatingFetchSites(fs.readFileSync(f, "utf8")).length > 0);

  test("the walk finds files that save", () => {
    expect(withMutatingFetch.length).toBeGreaterThan(5);
  });

  test.each(withMutatingFetch.map((f) => path.relative(process.cwd(), f)))(
    "%s calls router.refresh() near every save, leaves with a full load, or says why not",
    (rel) => {
      const src = fs.readFileSync(path.join(process.cwd(), rel), "utf8");
      const bad = unaddressedSites(src);
      expect(
        bad,
        `${rel}: a mutating fetch at line(s) ${bad.join(", ")} never calls router.refresh() nearby, never leaves ` +
          `with a full load, and has no "// no-refresh: <reason>" comment — the next page will show stale data.`,
      ).toEqual([]);
    },
  );
});
