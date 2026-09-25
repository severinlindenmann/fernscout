// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, test } from "vitest";
import StepBody from "@/components/studio/StepBody";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * B2094 — a wizard's step change fades its body in; the chrome does not move.
 *
 * What a unit test can hold: the body is a new element on every step change
 * (a CSS animation runs on insertion only, so this is what makes one fade per
 * change and none per re-render), every wizard renders through it, and the
 * motion exists only inside `prefers-reduced-motion: no-preference`. What the
 * fade looks like is in the ticket's browser evidence.
 */

const ROOT = path.join(import.meta.dirname, "..");

describe("StepBody (B2094)", () => {
  test("a new step is a new element; a re-render of the same step is not", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    act(() => root.render(<StepBody step="gather">one</StepBody>));
    const first = container.querySelector(".studio-step");
    act(() => root.render(<StepBody step="gather">one, typed into</StepBody>));
    expect(container.querySelector(".studio-step")).toBe(first);
    act(() => root.render(<StepBody step="decide">two</StepBody>));
    expect(container.querySelector(".studio-step")).not.toBe(first);
    act(() => root.unmount());
  });

  test("B2136: a step change moves focus to the new step's heading; the first render does not", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    act(() => root.render(<StepBody step="gather"><h2>Who</h2></StepBody>));
    expect(document.activeElement).toBe(document.body);
    act(() => root.render(<StepBody step="decide"><h2>Check</h2></StepBody>));
    const h2 = container.querySelector("h2")!;
    expect(h2.textContent).toBe("Check");
    expect(document.activeElement).toBe(h2);
    expect(h2.tabIndex).toBe(-1);
    act(() => root.unmount());
    container.remove();
  });

  test("every studio wizard on useStep renders its steps through StepBody", () => {
    const walk = (dir: string): string[] =>
      fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith(".tsx") ? [path.join(dir, e.name)] : [],
      );
    const wizards = walk("components/studio").filter((f) => /\buseStep\(/.test(fs.readFileSync(path.join(ROOT, f), "utf8")));
    expect(wizards.length).toBeGreaterThan(0);
    const bare = wizards.filter((f) => !/<StepBody step=/.test(fs.readFileSync(path.join(ROOT, f), "utf8")));
    expect(bare).toEqual([]);
  });

  test("the fade exists only for somebody who has not asked for less motion", () => {
    const css = fs.readFileSync(path.join(ROOT, "app/globals.css"), "utf8");
    const open = css.indexOf("@media (prefers-reduced-motion: no-preference)");
    expect(open).toBeGreaterThan(-1);
    // The block's extent, by brace depth.
    let depth = 0;
    let end = css.indexOf("{", open);
    for (let i = end; i < css.length; i++) {
      if (css[i] === "{") depth++;
      if (css[i] === "}" && --depth === 0) {
        end = i;
        break;
      }
    }
    // Comments may name the classes; only rules count.
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, (c) => " ".repeat(c.length));
    const uses = [...rules.matchAll(/\.studio-(step|done-band|done-card)\b/g)].map((m) => m.index);
    expect(uses.length).toBeGreaterThan(0);
    expect(uses.filter((i) => i < open || i > end)).toEqual([]);
    expect(rules.slice(open, end)).toContain("120ms");
    expect(rules.slice(open, end)).toContain("60ms");
  });
});
