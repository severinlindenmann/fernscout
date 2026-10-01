// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test } from "vitest";
import RecordButton from "@/components/RecordButton";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";

/**
 * B2234/B2591 — a plan with no AI days left is said before the tap, in both
 * of the two non-`compact` forms: the plain button and the question
 * screen's `hero` mic. `undefined`/`null` (no host passes `aiAvailable`) is
 * "not checked here" and changes nothing — every existing caller stays
 * exactly as it was.
 */

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

function render(props: Partial<React.ComponentProps<typeof RecordButton>> = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
        <RecordButton username="alex" consented provider="dry-run" onText={() => {}} {...props} />
      </LocaleProvider>,
    );
  });
  return container!;
}

describe("B2234/B2591 — RecordButton refuses the tap with no AI days left", () => {
  test("aiAvailable: false shows the notice and no button, in the plain form", () => {
    const el = render({ aiAvailable: false });
    expect(el.querySelector("button")).toBeNull();
    expect(el.textContent).toContain("Your AI days for this plan are used up.");
    const link = el.querySelector("a");
    expect(link?.getAttribute("href")).toBe("/prices");
  });

  test("aiAvailable: false shows the notice and no button, in the hero form", () => {
    const el = render({ aiAvailable: false, hero: true, hold: false });
    expect(el.querySelector("button")).toBeNull();
    expect(el.textContent).toContain("Your AI days for this plan are used up.");
  });

  test("aiAvailable: true shows the button as normal", () => {
    const el = render({ aiAvailable: true });
    expect(el.querySelector("button")).not.toBeNull();
    expect(el.textContent).not.toContain("Your AI days for this plan are used up.");
  });

  test("no aiAvailable prop (every existing caller) changes nothing", () => {
    const el = render({});
    expect(el.querySelector("button")).not.toBeNull();
  });
});
