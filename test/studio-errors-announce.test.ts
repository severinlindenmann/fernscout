import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

/**
 * B2070 — every error a studio flow shows announces itself. A coral text
 * element (the colour this app keeps for errors and deletes) under the
 * studio is either a `role="alert"` line or not coral at all. Controls
 * (a delete button or link) and decoration (`aria-hidden`, an icon
 * component) are not text a screen reader would miss, so the scan looks
 * at lowercase text tags only. No allow-list.
 */

const ROOTS = ["components/studio", "app/[user]/studio"];
const TEXT_TAGS = new Set(["p", "span", "em", "strong", "small", "div", "li", "label"]);

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return files(full);
    return entry.name.endsWith(".tsx") ? [full] : [];
  });
}

function offenders(): string[] {
  const found: string[] = [];
  for (const file of ROOTS.flatMap((root) => files(path.join(process.cwd(), root)))) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(/text-coral-600/g)) {
      const before = source.slice(0, match.index);
      const open = [...before.matchAll(/<([A-Za-z][\w.]*)\b/g)].at(-1);
      if (!open || !TEXT_TAGS.has(open[1])) continue;
      const tag = source.slice(open.index, source.indexOf(">", match.index) + 1);
      if (tag.includes('aria-hidden')) continue;
      if (tag.includes('role="alert"')) continue;
      const line = before.split("\n").length;
      found.push(`${path.relative(process.cwd(), file)}:${line} <${open[1]}> ${tag.replace(/\s+/g, " ").slice(0, 120)}`);
    }
  }
  return found;
}

describe("B2070 — studio errors announce themselves", () => {
  test("no coral text element under the studio lacks role=alert", () => {
    const list = offenders();
    expect(list, list.join("\n")).toEqual([]);
  });

  test("SubmitError is one role=alert line and nothing when there is no message", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { createElement } = await import("react");
    const { default: SubmitError } = await import("@/components/studio/SubmitError");
    expect(renderToStaticMarkup(createElement(SubmitError, { message: "It did not save." }))).toBe(
      '<p role="alert" class="mt-4 text-sm text-coral-600">It did not save.</p>',
    );
    expect(renderToStaticMarkup(createElement(SubmitError, { message: "" }))).toBe("");
  });

  test("DecideList and StudioPage show their write error through SubmitError", () => {
    for (const file of ["components/studio/DecideList.tsx", "components/studio/StudioPage.tsx"]) {
      expect(fs.readFileSync(path.join(process.cwd(), file), "utf8").includes("<SubmitError"), file).toBe(true);
    }
  });
});
