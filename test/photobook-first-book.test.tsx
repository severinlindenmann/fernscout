// @vitest-environment jsdom
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test } from "vitest";
import FirstBookFlow from "@/app/[user]/(trip)/photobook/FirstBookFlow";
import { initialBookOptions, type BookOptions } from "@/lib/photobook/options";

/**
 * B704 — the first-book questions.
 *
 * The promise that matters is the one about somebody who does not care: four
 * taps of "next" must produce exactly the book the composer would have
 * produced on its own. A flow that quietly changes the defaults is worse than
 * no flow, because the person who skipped it never sees what it decided.
 */

// React only suppresses its "not configured to support act" warning when the
// environment says so; the flag is the documented way to say it.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

const INITIAL = () => initialBookOptions("de", true, true);

/** Renders the flow over real state, and hands back what the options are now. */
function mount(over: Partial<Parameters<typeof FirstBookFlow>[0]> = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const seen: { options: BookOptions; done: boolean } = { options: INITIAL(), done: false };

  function Host() {
    const [options, setOptions] = useState<BookOptions>(INITIAL());
    // In an effect rather than during the render: what this test asserts on is
    // the options as they actually landed, which is the same thing the effect
    // sees, and writing to it mid-render is the lint rule's own example of
    // what not to do.
    useEffect(() => {
      seen.options = options;
    }, [options]);
    return (
      <FirstBookFlow
        options={options}
        setOptions={(update) => setOptions((o) => update(o))}
        media={[]}
        hasCosts
        hasWeather
        preview={null}
        onDone={() => {
          seen.done = true;
        }}
        t={(key) => key}
        {...over}
      />
    );
  }

  act(() => root!.render(<Host />));
  return seen;
}

/** The first button whose text is exactly this key — `t` is the identity here. */
function click(label: string) {
  const button = [...container!.querySelectorAll("button")].find((b) => b.textContent === label);
  if (!button) throw new Error(`no button labelled ${label}`);
  act(() => button.click());
}

function tile(label: string) {
  const button = [...container!.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(label),
  );
  if (!button) throw new Error(`no tile mentioning ${label}`);
  return button;
}

describe("the first-book questions", () => {
  test("answering none of them leaves the book exactly as the composer would have made it", () => {
    const seen = mount();
    for (let i = 0; i < 4; i++) click("photobook.first.next");
    click("photobook.first.open");
    expect(seen.done).toBe(true);
    expect(seen.options).toEqual(INITIAL());
  });

  test("skipping out of the first question is the same book, and no more questions", () => {
    const seen = mount();
    click("photobook.first.skip");
    expect(seen.done).toBe(true);
    expect(seen.options).toEqual(INITIAL());
  });

  test("an answer is written when it is given, not at the end", () => {
    const seen = mount();
    click("photobook.first.next"); // to the words question
    act(() => tile("photobook.first.text.without").click());
    expect(seen.options.includeText).toBe(false);
    // Still on the question, and the answer given is the one shown as chosen.
    expect(tile("photobook.first.text.without").getAttribute("aria-checked")).toBe("true");
    expect(tile("photobook.first.text.with").getAttribute("aria-checked")).toBe("false");
  });

  test("the numbers tile is two switches, because it is one decision", () => {
    const seen = mount();
    click("photobook.first.next");
    click("photobook.first.next"); // the extras
    expect(seen.options.includeCosts).toBe(true);
    expect(seen.options.includeCharts).toBe(true);
    act(() => tile("photobook.first.extras.numbers").click());
    expect(seen.options.includeCosts).toBe(false);
    expect(seen.options.includeCharts).toBe(false);
  });

  test("a trip with no budget and no weather is never asked about numbers", () => {
    mount({ hasCosts: false, hasWeather: false });
    click("photobook.first.next");
    click("photobook.first.next");
    expect(container!.textContent).not.toContain("photobook.first.extras.numbers");
    expect(container!.textContent).toContain("photobook.first.extras.map");
  });

  test("the binding is stated with its page count, never asked", () => {
    mount({
      preview: {
        html: "",
        pages: 64,
        volumes: 1,
        credits: 218,
        ratio: 2,
        warnings: [],
        buyable: true,
      },
    });
    for (let i = 0; i < 4; i++) click("photobook.first.next");
    expect(container!.textContent).toContain("photobook.first.bindingPerfect");
    // No radio anywhere in the flow: the panel keeps those.
    expect(container!.querySelector('input[type="radio"]')).toBeNull();
  });
});
