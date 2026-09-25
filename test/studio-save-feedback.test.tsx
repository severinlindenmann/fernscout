// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import BusyButton from "@/components/BusyButton";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROOT = path.join(import.meta.dirname, "..");

/**
 * B2325 — a studio save shows something at the place the finger was, and a
 * studio list arrives rather than jumping into place. What a unit test can
 * hold: `BusyButton`'s `done`/`shake` props render the right markup and
 * never on their own timer (the caller decides when, from a real response),
 * the motion exists only for somebody who has not asked for less of it, and
 * the one flow this ticket wires (`TripEditFlow`'s Save, which — unlike
 * every `DoneScreen`-terminated flow — leaves the person on the same
 * screen) fires its haptics from the response, not the tap. What the check,
 * the shake and a card's arrival look like is in the ticket's browser
 * evidence.
 */
describe("BusyButton done/shake (B2325)", () => {
  test("done draws a check, turns the success colour, and hides the label", () => {
    const idle = renderToStaticMarkup(<BusyButton busy={false}>Save</BusyButton>);
    expect(idle).toContain(">Save<");
    expect(idle).not.toContain("fs-check");

    const html = renderToStaticMarkup(
      <BusyButton busy={false} done>
        Save
      </BusyButton>,
    );
    expect(html).toContain("fs-check");
    expect(html).not.toContain(">Save<");
    expect(html).toContain("var(--color-green-700)");
    // Never spinning and never pressable a second time while it holds.
    expect(html).not.toContain("animate-spin");
    expect(html).toContain("disabled");
  });

  test("done is never busy's own doing — only the caller's explicit prop", () => {
    // A caller that is merely busy (mid-request) must not show a check —
    // "never on tap" means never before the caller has a real answer.
    const html = renderToStaticMarkup(<BusyButton busy>Save</BusyButton>);
    expect(html).not.toContain("fs-check");
    expect(html).toContain("animate-spin");
  });

  test("shake fires once when the caller's value changes to a new truthy one, and stops", () => {
    vi.useFakeTimers();
    const container = document.createElement("div");
    const root = createRoot(container);
    const render = (shake: string | null) =>
      act(() => root.render(<BusyButton shake={shake}>Save</BusyButton>));

    render(null);
    const button = container.querySelector("button")!;
    expect(button.className).not.toContain("fs-shake");

    render("Could not save.");
    expect(button.className).toContain("fs-shake");

    act(() => vi.advanceTimersByTime(300));
    expect(button.className).not.toContain("fs-shake");

    // Cleared, then the exact same message again — a caller nulls its error
    // at the start of every attempt, so this is the ordinary repeat case.
    render(null);
    render("Could not save.");
    expect(button.className).toContain("fs-shake");

    act(() => root.unmount());
    vi.useRealTimers();
  });
});

describe("the studio's own success/error haptics fire from the response (B2325)", () => {
  test("TripEditFlow's Save wires done/shake to BusyButton and fires haptic only after the write answers", () => {
    const src = fs.readFileSync(path.join(ROOT, "components/studio/trip/TripEditFlow.tsx"), "utf8");
    expect(src).toContain("done={done}");
    expect(src).toContain("shake={problem}");

    // The two haptic calls sit after the fetches resolve (inside `save`),
    // never beside the `onClick` that starts them.
    const saveFn = src.slice(src.indexOf("async function save()"), src.indexOf("\n  return (", src.indexOf("async function save()")));
    expect(saveFn).toContain('haptic("success")');
    expect(saveFn).toContain('haptic("error")');
    const onClick = src.slice(src.indexOf("onClick={() => void save()}"), src.indexOf("onClick={() => void save()}") + 40);
    expect(onClick).not.toContain("haptic");
  });
});

describe("a studio hub card and an inbox row arrive once, not on every re-render (B2325)", () => {
  test("StudioHub's cards carry .fs-arrive with an index, not a class toggled on and off", () => {
    const src = fs.readFileSync(path.join(ROOT, "components/studio/StudioHub.tsx"), "utf8");
    expect(src).toContain('className="fs-arrive');
    expect(src).toContain('style={{ "--i": arriveIndex }');
    // Applied at every call site, not just declared on the function — a
    // card with no index would default `--i` to nothing rather than 0.
    expect(src).toContain("arriveIndex={0}");
    expect(src).toContain("arriveIndex={groups.length}");
  });

  test("an inbox row carries .fs-arrive too, keyed so a move/delete elsewhere does not remount the rows that stay", () => {
    const tile = fs.readFileSync(path.join(ROOT, "components/studio/inbox/InboxTile.tsx"), "utf8");
    expect(tile).toContain('className="fs-arrive');
    const hub = fs.readFileSync(path.join(ROOT, "components/studio/inbox/InboxHub.tsx"), "utf8");
    expect(hub).toContain("arriveIndex={i}");
    // `rows.map((row, i) =>` keeps each tile's own key (`keyOf`, scoped to
    // id+day) stable across a state update, which is what keeps the DOM
    // node — and so the already-run animation — the same one.
    expect(hub).toContain("key={key}");
  });
});

describe("B2325's motion exists only for somebody who has not asked for less of it", () => {
  test("fs-check, fs-shake and fs-arrive's animations are inside prefers-reduced-motion: no-preference", () => {
    const css = fs.readFileSync(path.join(ROOT, "app/globals.css"), "utf8");
    // The last "no-preference" block in the file — B2325's own, appended
    // after B2326's view-transition block per the brief.
    const marker = css.lastIndexOf("@media (prefers-reduced-motion: no-preference)");
    expect(marker).toBeGreaterThan(-1);
    let depth = 0;
    let end = css.indexOf("{", marker);
    for (let i = end; i < css.length; i++) {
      if (css[i] === "{") depth++;
      if (css[i] === "}" && --depth === 0) {
        end = i;
        break;
      }
    }
    const block = css.slice(marker, end);
    expect(block).toContain("fs-check-draw");
    expect(block).toContain("fs-shake");
    expect(block).toContain("fs-arrive");

    // The check's own base (fully drawn, no draw-in) is unconditional —
    // reduced motion must still show a finished check, not an invisible one.
    const base = css.slice(0, marker);
    expect(base).toContain("stroke-dashoffset: 0");
  });
});
