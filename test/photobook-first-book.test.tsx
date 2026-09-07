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

/** Filled by the test that watches `setDayExcluded`. */
let mountedExcluded: string[] | undefined;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  mountedExcluded = undefined;
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

const INITIAL = () => initialBookOptions("de", true, true);

/** Two days, so the "which days" step is offered — a one-day trip skips it. */
const DAYS = [
  { date: "2026-01-01", title: "Day one", location: "Lagos" },
  { date: "2026-01-02", title: "Day two", location: "Faro" },
];

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
        days={DAYS}
        locales={["de"]}
        hasCosts
        hasWeather
        hasFigures
        hadSaved={false}
        preview={null}
        applyLayoutToAll={() => {}}
        setDayExcluded={(date) => mountedExcluded?.push(date)}
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

/** Taps "next" until the step whose heading key this is, or gives up loudly.
 * Written this way rather than counting taps because the list of steps depends
 * on the trip — a one-day trip has no "which days", a single-language journal
 * no language step — and a test that counts would pin the wrong thing. */
function goTo(headingKey: string) {
  for (let i = 0; i < 10; i++) {
    if (container!.querySelector("h2")?.textContent === headingKey) return;
    click("photobook.first.next");
  }
  throw new Error(`never reached ${headingKey}`);
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
    goTo("photobook.first.summary");
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
    goTo("photobook.first.text");
    act(() => tile("photobook.first.text.without").click());
    expect(seen.options.includeText).toBe(false);
    // Still on the question, and the answer given is the one shown as chosen.
    expect(tile("photobook.first.text.without").getAttribute("aria-checked")).toBe("true");
    expect(tile("photobook.first.text.with").getAttribute("aria-checked")).toBe("false");
  });

  test("the numbers tile is two switches, because it is one decision", () => {
    const seen = mount();
    goTo("photobook.first.extras");
    expect(seen.options.includeCosts).toBe(true);
    expect(seen.options.includeCharts).toBe(true);
    act(() => tile("photobook.first.extras.numbers").click());
    expect(seen.options.includeCosts).toBe(false);
    expect(seen.options.includeCharts).toBe(false);
  });

  test("a trip with no budget and no weather is never asked about numbers", () => {
    mount({ hasCosts: false, hasWeather: false });
    goTo("photobook.first.extras");
    expect(container!.textContent).not.toContain("photobook.first.extras.numbers");
    expect(container!.textContent).toContain("photobook.first.extras.map");
  });

  test("a saved arrangement is met with an offer to carry on, not a question", () => {
    const seen = mount({ hadSaved: true });
    expect(container!.querySelector("h2")!.textContent).toBe("photobook.first.resume");
    act(() => tile("photobook.first.resume.carryOn").click());
    expect(seen.done).toBe(true);
    expect(seen.options).toEqual(INITIAL());
  });

  test("…and going through them anyway starts at the first question", () => {
    mount({ hadSaved: true });
    act(() => tile("photobook.first.resume.again").click());
    expect(container!.querySelector("h2")!.textContent).toBe("photobook.first.size");
  });

  test("a day left out is a day the planner is told to leave out", () => {
    const seen = mount();
    goTo("photobook.first.days");
    const excluded: string[] = [];
    // `setDayExcluded` is the composer's own; the flow's job is to call it.
    mountedExcluded = excluded;
    act(() => tile("Day two").click());
    expect(excluded).toEqual(["2026-01-02"]);
    expect(seen.done).toBe(false);
  });

  test("a one-day trip is never asked which days", () => {
    mount({ days: [DAYS[0]] });
    goTo("photobook.first.extras");
    expect(container!.textContent).not.toContain("photobook.first.days");
  });

  test("the figures switch is offered only where somebody has been described", () => {
    mount({ hasFigures: false });
    goTo("photobook.first.extras");
    expect(container!.textContent).not.toContain("photobook.first.extras.figures");
    mount({ hasFigures: true });
    goTo("photobook.first.extras");
    expect(container!.textContent).toContain("photobook.first.extras.figures");
  });

  test("the language is asked only where the journal offers more than one", () => {
    mount({ locales: ["de"] });
    goTo("photobook.first.summary");
    expect(container!.textContent).not.toContain("photobook.first.language");
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
    goTo("photobook.first.summary");
    expect(container!.textContent).toContain("photobook.first.bindingPerfect");
    // No radio anywhere in the flow: the panel keeps those.
    expect(container!.querySelector('input[type="radio"]')).toBeNull();
  });
});
