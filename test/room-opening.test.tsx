// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test } from "vitest";
import RoomOpening from "@/components/RoomOpening";
import LocaleProvider from "@/components/LocaleProvider";
import type { Opening } from "@/lib/helper/opening";
import { dictionaryFor } from "@/lib/locales";

/**
 * One bright thing — B1021.
 *
 * `RoomOpening.tsx`'s own doc comment used to name this file without it
 * existing, and the rule it described — one `bg-yellow-400` anywhere on the
 * screen — is false the moment a day is already loaded in the preview pane:
 * `StoryPager.tsx` draws the current position as a dot in the same yellow,
 * and it is `aria-hidden` and pressable by nobody.
 *
 * So what is checked here is the rule that survives that finding: **one
 * bright thing that can be pressed**, per state of this component, counted as
 * `bg-yellow-400` **buttons** rather than every element carrying the colour.
 */

const dictionary = dictionaryFor("en");

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

function render(opening: Opening, whatsappNumber?: string) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <LocaleProvider locale="en" dictionary={dictionary}>
        <RoomOpening opening={opening} onSay={() => {}} whatsappNumber={whatsappNumber} />
      </LocaleProvider>,
    );
  });
  return container!;
}

function brightButtons(node: HTMLElement): HTMLButtonElement[] {
  return [...node.querySelectorAll("button")].filter((button) =>
    button.className.includes("bg-yellow-400"),
  );
}

const STATES: Opening[] = [
  {
    state: "days",
    days: [{ trip: "a-trip", slug: "tuesday", date: "2026-04-30", title: "Tuesday", photos: 0, written: false }],
    more: 0,
  },
  { state: "clear", lastDate: "2026-04-01" },
  { state: "finished", trip: "a-trip", title: "A Trip", days: 5 },
  { state: "empty" },
];

describe("one bright thing per state", () => {
  for (const opening of STATES) {
    test(`exactly one bg-yellow-400 button in "${opening.state}"`, () => {
      const node = render(opening);
      expect(brightButtons(node)).toHaveLength(1);
    });
  }
});

/**
 * The wa.me chip — B1127. Both gating facts (a proven number, this
 * journal's own `whatsappInbound` opt-in) are checked server-side before
 * `whatsappNumber` ever reaches this component; here it is only ever "was a
 * number handed over, or not".
 */
describe("the WhatsApp chip", () => {
  test("is absent with no number handed over", () => {
    const node = render({ state: "empty" });
    expect(node.querySelector('a[href*="wa.me"]')).toBeNull();
  });

  test("is a wa.me link carrying the number and a prefilled greeting, in every state", () => {
    for (const opening of STATES) {
      const node = render(opening, "41782172640");
      const link = node.querySelector('a[href*="wa.me"]');
      expect(link).not.toBeNull();
      expect(link!.getAttribute("href")).toContain("wa.me/41782172640");
      expect(link!.getAttribute("href")).toContain("text=");
      // A link out of the room, not a chip that sends a sentence through it.
      expect(link!.getAttribute("target")).toBe("_blank");
    }
  });
});
