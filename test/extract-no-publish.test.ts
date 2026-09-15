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
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const FORBIDDEN = [/day\/publish/, /publishDraft/];

describe("components/extract never publishes", () => {
  const dir = path.join(import.meta.dirname, "..", "components", "extract");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));

  test("at least the files this task touches are actually checked", () => {
    expect(files).toEqual(expect.arrayContaining(["ExtractFlow.tsx", "PreviewScreen.tsx", "CreditsScreen.tsx"]));
  });

  for (const file of files) {
    test(`${file} contains no call, in code, to the publish route`, () => {
      const code = stripComments(fs.readFileSync(path.join(dir, file), "utf8"));
      for (const pattern of FORBIDDEN) {
        expect(code).not.toMatch(pattern);
      }
    });
  }
});
