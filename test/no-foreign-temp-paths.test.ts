import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// B-2744: a test must not depend on another agent session's temp folder.
describe("tests do not read another session's temp folder", () => {
  it("no test file names a scratchpad or /private/tmp/claude path", () => {
    const dir = __dirname;
    const self = path.basename(__filename);
    const bad = [
      ...(function walk(d: string): string[] {
        return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
          const f = path.join(d, e.name);
          return e.isDirectory() ? walk(f) : [f];
        });
      })(dir),
    ].filter(
      (f) =>
        /\.(ts|tsx|mjs|js)$/.test(f) &&
        path.basename(f) !== self &&
        /scratchpad|\/private\/tmp\/claude|\/tmp\/claude-/.test(fs.readFileSync(f, "utf8")),
    );
    expect(bad.map((f) => path.relative(dir, f))).toEqual([]);
  });
});
