import fs from "node:fs";
import { expect, test } from "vitest";

// MapLibre makes a marker's root element absolutely positioned. An inline
// `position:relative` on that root put the element back in the page flow, so
// each marker drifted by the width of the ones before it (B-2980).
test("marker root elements do not set their own position", () => {
  const src = fs.readFileSync("lib/map/streetOverlay.ts", "utf8");
  const roots = src.split("\n").filter((l) => /^\s*(el\.style\.cssText\s*=|"display:flex;align-items:center;gap:4px)/.test(l));
  expect(roots.length).toBeGreaterThan(0);
  for (const line of roots) expect(line).not.toMatch(/position:\s*relative/);
  expect(src).not.toMatch(/el\.style\.cssText\s*=\s*"position:relative/);
});
