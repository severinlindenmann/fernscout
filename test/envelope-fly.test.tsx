// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

/**
 * B753 — pressing "Send me a code" plays a short envelope departure, and
 * `prefers-reduced-motion: reduce` skips it outright rather than merely
 * shortening it.
 *
 * `motion/react` is mocked rather than driven through a real
 * `prefers-reduced-motion` media query: `useReducedMotion`'s answer is cached
 * in a module-level singleton that only reads `matchMedia` once per module
 * instance, so a real read is a fact about the first test in the file rather
 * than about each case. Mocking `useReducedMotion` directly, and `motion.svg`
 * as an ordinary `<svg>`, tests what `IdentitySignIn` and `EnvelopeFly`
 * actually decide rather than framer-motion's own caching.
 */

let root: Root | undefined;
let container: HTMLDivElement | undefined;

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 202 })),
  );
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = undefined;
  root = undefined;
  vi.unstubAllGlobals();
  vi.doUnmock("motion/react");
  vi.resetModules();
});

async function mount(reduceMotion: boolean) {
  vi.doMock("motion/react", () => ({
    useReducedMotion: () => reduceMotion,
    MotionConfig: ({ children }: { children: React.ReactNode }) => children,
    motion: {
      // Only the DOM-facing props matter here — animation is not what this
      // file is testing, so the animation-only ones (onAnimationComplete,
      // initial, animate, transition) are dropped rather than named.
      svg: (props: Record<string, unknown>) => {
        const dom = { ...props };
        for (const key of ["onAnimationComplete", "initial", "animate", "transition"]) {
          delete dom[key];
        }
        return <svg {...(dom as React.SVGProps<SVGSVGElement>)} />;
      },
    },
  }));
  const { default: IdentitySignIn } = await import("@/components/IdentitySignIn");
  const { default: LocaleProvider } = await import("@/components/LocaleProvider");
  const { dictionaryFor } = await import("@/lib/locales");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
        <IdentitySignIn codeMinutes="30" onDone={() => {}} />
      </LocaleProvider>,
    );
  });
}

async function fillEmailAndSend() {
  const input = container!.querySelector("input") as HTMLInputElement;
  const field = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )!.set!;
  await act(async () => {
    field.call(input, "reader@example.test");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const form = container!.querySelector("form") as HTMLFormElement;
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 0));
  });
}

function envelope(): SVGElement | null {
  return container!.querySelector('svg[aria-hidden="true"]');
}

describe("the envelope on send", () => {
  test("plays on an ordinary send", async () => {
    await mount(false);
    expect(envelope()).toBeNull();
    await fillEmailAndSend();
    expect(envelope()).not.toBeNull();
  });

  test("does not play under prefers-reduced-motion: reduce", async () => {
    await mount(true);
    await fillEmailAndSend();
    expect(envelope()).toBeNull();
    // The state change is still legible without the flight: the code field
    // arrives once the (stubbed) request resolves.
    expect(container!.textContent).toContain("A code is on its way");
  });

  test("does not play on mount, only on a send", async () => {
    await mount(false);
    expect(envelope()).toBeNull();
  });
});
