import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

/**
 * The one non-negotiable rule of B1751 Task 4.2: nothing under
 * `components/extract/` may call `POST .../day/publish`. Publishing is the
 * owner's own call, made in words, from the agent room — this flow only ever
 * *links* to where that happens (see `PreviewScreen.tsx`'s own doc comment).
 *
 * Comments are allowed to *name* the route — `PreviewScreen.tsx` does, to
 * explain the link — so this strips comments first and then checks the code
 * that is left for anything that would actually reach it: the route's own
 * path, an import of its handler, or the pure function it calls to publish.
 *
 * **What this proves, and what it does not.** The walk is recursive — a
 * subdirectory of `components/extract/` cannot hide a call from it — and it
 * also covers `lib/extract/`, the one other place a helper for this flow
 * would plausibly live. It does **not** prove nothing under
 * `components/extract/` can ever cause a publish: a call routed through a
 * helper that lives *outside* both scanned trees, imported under a neutral
 * name, would not be caught here, and neither would a path built from
 * concatenated string parts rather than written as one of the two literals
 * below. Both were left uncaught on purpose rather than chased with a
 * cleverer regex — a check that tries to defeat renaming and string-building
 * is fragile, fails for the wrong reasons, and is the kind of check a future
 * change ends up deleting because it blocks something innocent. This is a
 * strong guard against the direct case and an honest silence about the rest,
 * not a proof that covers every route there.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/** Every `.ts`/`.tsx` file under `dir`, walked recursively. */
function sourceFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFilesUnder(full));
    else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

const FORBIDDEN = [/day\/publish/, /publishDraft/];

const ROOT = path.join(import.meta.dirname, "..");
const SCANNED = {
  "components/extract": path.join(ROOT, "components", "extract"),
  "lib/extract": path.join(ROOT, "lib", "extract"),
};

describe("the camera roll import never publishes", () => {
  for (const [label, dir] of Object.entries(SCANNED)) {
    const files = sourceFilesUnder(dir);

    test(`${label} actually has files to check`, () => {
      expect(files.length).toBeGreaterThan(0);
    });

    for (const file of files) {
      test(`${path.relative(ROOT, file)} contains no call, in code, to the publish route`, () => {
        const code = stripComments(fs.readFileSync(file, "utf8"));
        for (const pattern of FORBIDDEN) {
          expect(code).not.toMatch(pattern);
        }
      });
    }
  }
});
