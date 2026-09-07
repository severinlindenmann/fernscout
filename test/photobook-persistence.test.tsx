// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { StrictMode } from "react";
import { afterEach, describe, expect, test } from "vitest";
import { usePersistedState } from "@/app/[user]/(trip)/photobook/usePersistedState";

/**
 * B507 — a saved arrangement must survive a reload, in every mode React runs
 * in, not only in the one nobody happened to test in.
 *
 * The photobook composer persisted `BookOptions` to `localStorage` with two
 * effects: one that read a saved value back after mounting, guarded by a
 * `useRef` that a second effect checked before writing. That guard flipped
 * true *inside* the restore effect, before the `setOptions` it had just
 * queued had landed in a render — so under React's Strict Mode
 * development-only double-effect invocation, the persist effect ran with the
 * ref already true and the render's still-default state, overwriting a real
 * save with nothing. `npm run dev` (Strict Mode on) lost every arrangement on
 * the very next reload; `npm run build && npm run start` (Strict Mode off)
 * never raced and never showed it — which is exactly the gap that let it
 * ship: the one environment an agent can drive locally without deploying
 * looked broken, and the one real users are served by did not.
 *
 * This test renders the real hook inside `<StrictMode>`, the only way to
 * reproduce the double invocation at all — `renderToStaticMarkup`, used
 * elsewhere in this suite for static output, never runs an effect.
 */

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  window.localStorage.clear();
});

function mount(storageKey: string, initial: { n: number }) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  function Probe() {
    const [value, setValue, hadSaved] = usePersistedState(storageKey, initial, (saved, current) => ({
      ...current,
      ...(JSON.parse(saved) as Partial<{ n: number }>),
    }));
    (globalThis as { __setValue?: typeof setValue }).__setValue = setValue;
    return (
      <>
        <output>{value.n}</output>
        <data value={String(hadSaved)} />
      </>
    );
  }

  act(() => {
    root!.render(
      <StrictMode>
        <Probe />
      </StrictMode>,
    );
  });
}

describe("usePersistedState under Strict Mode's double-effect invocation", () => {
  test("a value saved before mounting survives the mount, and every reload after it", () => {
    const key = "test:persisted:existing";
    window.localStorage.setItem(key, JSON.stringify({ n: 42 }));

    mount(key, { n: 0 });
    expect(container!.textContent).toBe("42");
    expect(JSON.parse(window.localStorage.getItem(key)!)).toEqual({ n: 42 });

    // A reload is a fresh mount reading the same key — simulate it directly
    // rather than through a real navigation, which jsdom cannot perform.
    act(() => root!.unmount());
    container!.remove();
    mount(key, { n: 0 });
    expect(container!.textContent).toBe("42");
    expect(JSON.parse(window.localStorage.getItem(key)!)).toEqual({ n: 42 });
  });

  test("a later change persists, and is what the next mount restores", () => {
    const key = "test:persisted:change";
    mount(key, { n: 1 });
    expect(JSON.parse(window.localStorage.getItem(key)!)).toEqual({ n: 1 });

    act(() => {
      (globalThis as { __setValue?: (v: { n: number }) => void }).__setValue?.({ n: 7 });
    });
    expect(JSON.parse(window.localStorage.getItem(key)!)).toEqual({ n: 7 });

    act(() => root!.unmount());
    container!.remove();
    mount(key, { n: 1 });
    expect(container!.textContent).toBe("7");
  });

  test("nothing saved yet: the initial value is what gets written, not lost or blanked", () => {
    const key = "test:persisted:fresh";
    mount(key, { n: 9 });
    expect(JSON.parse(window.localStorage.getItem(key)!)).toEqual({ n: 9 });
  });
});

/**
 * B704 — the composer shows the first-book questions to somebody who has
 * never arranged this book, and the composer to everybody else. The whole of
 * that decision is this flag, so it has to be right about a key that has
 * something in it and about one that does not.
 *
 * The trap it exists to avoid: the hook *writes* on its first render, so
 * asking `localStorage` a moment later always answers "yes, saved" — which
 * would mean nobody ever saw the flow. It is read once, before the first
 * write, and reported.
 */
describe("whether anything was saved before this mount", () => {
  const saved = () => container!.querySelector("data")!.getAttribute("value");

  test("false when the key is empty, even though mounting fills it", () => {
    const key = "test:persisted:first-visit";
    mount(key, { n: 3 });
    expect(saved()).toBe("false");
    // The write did happen — this is the case that could have made it "true".
    expect(JSON.parse(window.localStorage.getItem(key)!)).toEqual({ n: 3 });
  });

  test("true when something was there, and stays true across a reload", () => {
    const key = "test:persisted:returning";
    window.localStorage.setItem(key, JSON.stringify({ n: 5 }));
    mount(key, { n: 0 });
    expect(saved()).toBe("true");

    act(() => root!.unmount());
    container!.remove();
    mount(key, { n: 0 });
    expect(saved()).toBe("true");
  });
});
