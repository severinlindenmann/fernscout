import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * No question is asked by the browser — B668.
 *
 * `window.confirm`, `window.alert` and `window.prompt` render in the operating
 * system's own type, in a box whose title bar names the domain, over a page
 * that has gone to some trouble to look like somebody's travel journal. Each
 * one renders exactly one string, so none of them can show what is about to be
 * deleted, what something will cost, or offer a second choice beside the
 * first — which is why the storage cleanup ended up asking two stacked
 * dialogs in a row.
 *
 * `components/ConfirmPanel.tsx` is what to use instead.
 *
 * **This is a test rather than a sentence in AGENTS.md because the sentence
 * was tried first.** B633 replaced a `window.confirm` with a panel and wrote
 * down why; B661 and B664 each reached for `confirm()` again within the
 * fortnight. The rule is in AGENTS.md now *as well*, but this is the half that
 * holds.
 */

const ROOT = process.cwd();
const DIRS = ["app", "components"];

/** The calls, however they are reached. `window.` is optional in a browser and
 * a bare `confirm(…)` is the same function. */
const FORBIDDEN = /(?:^|[^.\w$])(?:window\s*\.\s*)?(confirm|alert|prompt)\s*\(/;

function walk(dir: string): string[] {
  const out: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * Comments are where the rule is *explained*, so they have to be allowed to
 * name the thing they are ruling out — several doc comments say
 * "rather than `window.confirm`" and would otherwise fail the test that
 * enforces what they say.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("browser dialogs", () => {
  test("nothing under app/ or components/ asks the browser a question", () => {
    const offenders: string[] = [];
    for (const file of DIRS.flatMap((d) => walk(path.join(ROOT, d)))) {
      const lines = stripComments(fs.readFileSync(file, "utf8")).split("\n");
      lines.forEach((line, at) => {
        if (FORBIDDEN.test(line)) {
          offenders.push(`${path.relative(ROOT, file)}:${at + 1}  ${line.trim()}`);
        }
      });
    }
    expect(
      offenders,
      "use components/ConfirmPanel.tsx — a question in the page, not in the browser's own box (B668)",
    ).toEqual([]);
  });

  /** The test is worth nothing if it does not fail on the thing it is named
   * after, and a regex over source is exactly the kind of guard that quietly
   * stops matching. */
  test("catches the calls it is named after, however they are written", () => {
    for (const source of [
      'if (window.confirm("really?")) go();',
      "if (confirm(message)) go();",
      'window.alert("done");',
      "const name = prompt('who?');",
      "if (window . confirm(x)) go();",
    ]) {
      expect(FORBIDDEN.test(source), source).toBe(true);
    }
  });

  /** And nothing else. `onConfirm`, a variable called `confirmLabel`, and a
   * method on some other object are all ordinary code. */
  test("does not fire on ordinary code that merely contains the word", () => {
    for (const source of [
      "onConfirm={() => act()}",
      "const confirmLabel = t('me.storageCleanupGo');",
      "await agentConfirm(request);",
      "setPending({ confirmLabel: x });",
      "type Props = { onConfirm: () => void };",
    ]) {
      expect(FORBIDDEN.test(source), source).toBe(false);
    }
  });
});
