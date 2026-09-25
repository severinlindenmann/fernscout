// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import IdentitySignIn from "@/components/IdentitySignIn";
import GuestSignIn from "@/components/GuestSignIn";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";

/**
 * B787 — the sign-in button may stay disabled when the address is autofilled.
 *
 * Chrome's own autofill (and some password managers) sets an input's
 * `.value` without dispatching the `input`/`change` event React's `onChange`
 * relies on. `email === ""` staying true in React state — while the field on
 * screen holds a real address — is what left the button permanently
 * disabled. This sets `.value` through the *prototype's* setter and skips
 * the event entirely, which is exactly what autofill did in the field
 * report: React never hears about it, the way `.value = "x"` alone would
 * merely be silently absorbed by React's own value tracker.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

function withLocale(node: React.ReactNode) {
  return (
    <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
      {node}
    </LocaleProvider>
  );
}

/** Sets a field's value the way autofill does: writes the DOM directly,
 * through the prototype setter, and dispatches nothing. React's own value
 * tracker never sees the change, so `onChange` never fires — the exact gap
 * B787 is about. */
function autofill(node: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(node, value);
}

describe("a field filled by autofill, not by React's onChange", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
    vi.unstubAllGlobals();
  });

  function q(id: string): HTMLInputElement {
    return container!.querySelector(`#${id}`) as HTMLInputElement;
  }

  function form(): HTMLFormElement {
    return container!.querySelector("form") as HTMLFormElement;
  }

  function button(): HTMLButtonElement {
    return container!.querySelector('button[type="submit"]') as HTMLButtonElement;
  }

  test("IdentitySignIn's send button is not disabled by React's stale state, and submits the real address", async () => {
    const fetchMock = vi.fn((_url: string, _init?: { body?: string }) =>
      Promise.resolve({ status: 202, ok: true }),
    );
    vi.stubGlobal("fetch", fetchMock);

    root = createRoot(container!);
    act(() => {
      root!.render(
        withLocale(<IdentitySignIn codeMinutes="30" onDone={() => {}} />),
      );
    });

    autofill(q("identity-email"), "reader@example.test");
    // The button must already be pressable — this is the regression itself:
    // it used to render `disabled` from mount and never leave that state
    // because `email === ""` in React never moved.
    expect(button().disabled).toBe(false);

    await act(async () => {
      form().requestSubmit();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(
      (fetchMock.mock.calls[0]?.[1] as { body: string }).body,
    );
    expect(body.email).toBe("reader@example.test");
  });

  test("GuestSignIn's send button behaves the same way", async () => {
    const fetchMock = vi.fn((_url: string, _init?: { body?: string }) =>
      Promise.resolve({ status: 202, ok: true }),
    );
    vi.stubGlobal("fetch", fetchMock);

    root = createRoot(container!);
    act(() => {
      root!.render(
        withLocale(
          <GuestSignIn username="ana" codeMinutes="30" />,
        ),
      );
    });

    autofill(q("signin-email"), "reader@example.test");
    expect(button().disabled).toBe(false);

    await act(async () => {
      form().requestSubmit();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(
      (fetchMock.mock.calls[0]?.[1] as { body: string }).body,
    );
    expect(body.email).toBe("reader@example.test");
  });

  /** An actually empty, required field is still refused — just natively,
   * by the browser's own constraint validation, rather than by a button
   * that never became pressable. jsdom does not implement constraint
   * validation UI, but it does refuse the submit: `requestSubmit()` fires no
   * `submit` event when a `required` field is empty. */
  test("a genuinely empty address still does not submit", async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ status: 202, ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    root = createRoot(container!);
    act(() => {
      root!.render(
        withLocale(<IdentitySignIn codeMinutes="30" onDone={() => {}} />),
      );
    });

    await act(async () => {
      form().requestSubmit();
      await Promise.resolve();
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
