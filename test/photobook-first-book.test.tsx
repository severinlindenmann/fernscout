// @vitest-environment jsdom
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test } from "vitest";
import LocaleProvider from "@/components/LocaleProvider";
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

/** Filled by the tests that watch `setDayExcluded` and the layout apply. */
let mountedExcluded: string[] | undefined;
let mountedLayouts: string[] | undefined;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  mountedExcluded = undefined;
  mountedLayouts = undefined;
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
function mount(
  over: Partial<Parameters<typeof FirstBookFlow>[0]> = {},
  /** The arrangement this book already has. A day carrying a `layout` is one
   * somebody arranged before the questions opened — B739. */
  initial: BookOptions = INITIAL(),
) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const seen: { options: BookOptions; done: boolean } = { options: INITIAL(), done: false };

  function Host() {
    const [options, setOptions] = useState<BookOptions>(initial);
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
        hasTransport
        hadSaved={false}
        preview={null}
        applyLayoutToEveryDay={() => mountedLayouts?.push('applied')}
        setDayExcluded={(date) => mountedExcluded?.push(date)}
        onDone={() => {
          seen.done = true;
        }}
        t={(key) => key}
        {...over}
      />
    );
  }

  // `ConfirmPanel` reads its cancel label from the dictionary, so the flow's
  // own question needs a provider around it — the keys are echoed back, which
  // is what every assertion here matches on.
  act(() =>
    root!.render(
      <LocaleProvider locale="en" dictionary={{}}>
        <Host />
      </LocaleProvider>,
    ),
  );
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

  // B739. The flow writes a layout onto every day the moment one is chosen,
  // so by the second tap nine days carry an override — the composer's own
  // guard would then warn about work the flow itself had just done.
  test("choosing one layout after another asks nothing on a book nobody arranged", () => {
    const applied: string[] = [];
    mountedLayouts = applied;
    mount();
    goTo("photobook.first.layout");
    act(() => tile("photobook.day.layout.grid").click());
    act(() => tile("photobook.day.layout.hero").click());
    expect(applied).toHaveLength(2);
    expect(container!.textContent).not.toContain("photobook.first.layoutOverwrite");
  });

  test("but a day arranged before the questions opened is asked about, once, in place", () => {
    const applied: string[] = [];
    mountedLayouts = applied;
    // A day arranged by hand before any of this — the flow snapshots that at
    // mount, so it has to be in the options the first render sees.
    mount({}, { ...INITIAL(), days: { "2026-01-01": { layout: "grid" } } });
    goTo("photobook.first.layout");
    act(() => tile("photobook.day.layout.hero").click());
    expect(applied).toHaveLength(0);
    expect(container!.textContent).toContain("photobook.first.layoutOverwrite");
    act(() => tile("photobook.day.applyToAllGo").click());
    expect(applied).toHaveLength(1);
    // Asked once: the next choice goes straight through.
    act(() => tile("photobook.day.layout.pair").click());
    expect(applied).toHaveLength(2);
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
    expect(container!.querySelector("h2")!.textContent).toBe("photobook.first.coverType");
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

  // B845: the cover is asked before the size, and the size grid it feeds
  // shows only what that cover actually offers.
  test("the size grid follows the chosen cover", () => {
    mount();
    expect(container!.querySelector("h2")!.textContent).toBe("photobook.first.coverType");
    act(() => tile("photobook.first.coverType.hard").click());
    click("photobook.first.next");
    expect(container!.querySelector("h2")!.textContent).toBe("photobook.first.size");
    expect(container!.textContent).not.toContain("photobook.size.pocket");
    expect(container!.textContent).toContain("photobook.size.largeSquare");
  });

  test("choosing a cover that cannot print the current size corrects it", () => {
    const seen = mount({}, { ...INITIAL(), coverType: "hard", size: "large-square" });
    act(() => tile("photobook.first.coverType.soft").click());
    expect(seen.options.coverType).toBe("soft");
    // "large-square" has no softcover product — the default for soft instead.
    expect(seen.options.size).toBe("pocket");
  });

  test("a size valid in both covers is left alone when the cover changes", () => {
    const seen = mount({}, { ...INITIAL(), coverType: "soft", size: "square" });
    act(() => tile("photobook.first.coverType.hard").click());
    expect(seen.options.coverType).toBe("hard");
    expect(seen.options.size).toBe("square");
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
