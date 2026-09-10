// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";

/**
 * B1221 — the scripted demo conversation behind "See how it works" on the
 * signed-out door.
 *
 * `motion/react` is mocked the same way `test/envelope-fly.test.tsx` mocks
 * it: `useReducedMotion`'s answer is cached per module instance, so a real
 * `matchMedia` read is a fact about the first test in the file rather than
 * about each case.
 */

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = undefined;
  root = undefined;
  vi.useRealTimers();
  vi.doUnmock("motion/react");
  vi.resetModules();
});

async function mountDemo(reduceMotion: boolean) {
  vi.doMock("motion/react", () => ({
    useReducedMotion: () => reduceMotion,
    MotionConfig: ({ children }: { children: React.ReactNode }) => children,
  }));
  const { default: DoorDemo } = await import("@/components/DoorDemo");
  const { default: LocaleProvider } = await import("@/components/LocaleProvider");
  const { dictionaryFor } = await import("@/lib/locales");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
        <DoorDemo />
      </LocaleProvider>,
    );
  });
}

describe("the door demo", () => {
  test("closed by default", async () => {
    await mountDemo(false);
    expect(container!.textContent).toContain("See how it works");
    expect(container!.querySelector('[aria-label="Demo conversation"]')).toBeNull();
  });

  test("opens on the control, and is labelled as a demo", async () => {
    vi.useFakeTimers();
    await mountDemo(false);
    const trigger = container!.querySelector("button") as HTMLButtonElement;
    act(() => trigger.click());
    const panel = container!.querySelector('[aria-label="Demo conversation"]');
    expect(panel).not.toBeNull();
    expect(panel!.textContent).toContain("Demo");
  });

  test("plays on timers when motion is not reduced: the transcript arrives gradually", async () => {
    vi.useFakeTimers();
    await mountDemo(false);
    const trigger = container!.querySelector("button") as HTMLButtonElement;
    act(() => trigger.click());

    // Nothing beyond the first beat right away.
    expect(container!.textContent).not.toContain("Saved as a draft");

    act(() => vi.runAllTimers());
    expect(container!.textContent).toContain("Saved as a draft");
  });

  test("reduced motion shows the whole transcript immediately, no timers", async () => {
    vi.useFakeTimers();
    await mountDemo(true);
    const trigger = container!.querySelector("button") as HTMLButtonElement;
    act(() => trigger.click());

    // No `vi.runAllTimers()` here: the whole script is already present.
    expect(container!.textContent).toContain("Saved as a draft");
  });

  test("the mock proposal button is not a live control", async () => {
    vi.useFakeTimers();
    await mountDemo(true);
    const trigger = container!.querySelector("button") as HTMLButtonElement;
    act(() => trigger.click());

    const buttons = [...container!.querySelectorAll("button")];
    const mock = buttons.find((b) => b.textContent === "Add it");
    expect(mock).toBeDefined();
    expect(mock!.disabled).toBe(true);
    expect(mock!.getAttribute("aria-hidden")).toBe("true");
  });
});
