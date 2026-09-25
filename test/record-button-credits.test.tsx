// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test } from "vitest";
import RecordButton from "@/components/RecordButton";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";

/**
 * B2234 — a balance below what even the shortest recording costs is said
 * before the tap, in both of the two forms that say a price at all: the
 * plain price-line button and the question screen's `hero` mic. `undefined`
 * (no host passes `credits`) changes nothing — every existing caller stays
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

describe("B2234 — RecordButton refuses the tap below the price", () => {
  test("a zero balance shows the notice and no button, in the plain price-line form", () => {
    const el = render({ credits: 0 });
    expect(el.querySelector("button")).toBeNull();
    expect(el.textContent).toContain("You have no credits left for this.");
    const link = el.querySelector("a");
    expect(link?.getAttribute("href")).toBe("/alex/studio/account");
  });

  test("a zero balance shows the notice and no button, in the hero form", () => {
    const el = render({ credits: 0, hero: true, hold: false });
    expect(el.querySelector("button")).toBeNull();
    expect(el.textContent).toContain("You have no credits left for this.");
  });

  test("a balance that covers the floor shows the button as normal", () => {
    const el = render({ credits: 1 });
    expect(el.querySelector("button")).not.toBeNull();
    expect(el.textContent).not.toContain("You have no credits left for this.");
  });

  test("no credits prop (every existing caller) changes nothing", () => {
    const el = render({});
    expect(el.querySelector("button")).not.toBeNull();
  });
});

// B2288 — `priceChf` is computed server-side (pricing is paid-only code
// after the open-core split); this component never imports it itself.
describe("B2288 — the plain price-line form takes its price as a prop", () => {
  test("priceChf set shows the CHF price", () => {
    const el = render({ priceChf: "CHF 0.01" });
    expect(el.textContent).toContain("about CHF 0.01");
  });

  test("priceChf null (a public build) shows the credit price alone, no CHF", () => {
    const el = render({ priceChf: null });
    expect(el.textContent).not.toContain("CHF");
    expect(el.textContent).toContain("Hold to talk");
  });
});
