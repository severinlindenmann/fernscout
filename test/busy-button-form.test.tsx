// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test } from "vitest";

import BusyButton from "@/components/BusyButton";

/**
 * The self-watching mode — B867. This is the half that carries the three
 * `<form method="post">` posts (the postcard send, the postcard text fallback
 * and the photobook order), and the half a static render cannot check: the
 * button has to notice its *own* form submitting, with no caller holding any
 * state, and it must not do anything the submit itself depends on.
 */
describe("BusyButton watching its own form", () => {
  let host: HTMLDivElement;
  let root: Root;

  function mount(ui: React.ReactNode) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root.render(ui));
    return host.querySelector("button")!;
  }

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  test("submitting the form turns the button busy", async () => {
    const button = mount(
      <form action="/x" method="post">
        <BusyButton type="submit">Send</BusyButton>
      </form>,
    );
    expect(button.disabled).toBe(false);
    expect(button.getAttribute("aria-busy")).toBe(null);

    await act(async () => {
      host.querySelector("form")!.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      // The state is set on a task, not synchronously — a submit button
      // disabled *during* its own submit event is left out of the form data.
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.querySelector("svg")).not.toBeNull();
  });

  test("it is not disabled during the submit event itself", () => {
    const button = mount(
      <form action="/x" method="post">
        <BusyButton type="submit">Send</BusyButton>
      </form>,
    );
    let disabledWhenFired: boolean | null = null;
    host.querySelector("form")!.addEventListener("submit", () => {
      // Registered after the component's own listener, so this runs second and
      // sees whatever the component did synchronously. It must see nothing:
      // a browser drops a disabled submit button's name and value.
      disabledWhenFired = button.disabled;
    });
    act(() => {
      host.querySelector("form")!.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    expect(disabledWhenFired).toBe(false);
  });

  test("a caller that holds the flag is not also self-watching", async () => {
    const button = mount(
      <form action="/x" method="post">
        <BusyButton type="submit" busy={false}>
          Send
        </BusyButton>
      </form>,
    );
    await act(async () => {
      host.querySelector("form")!.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      await new Promise((r) => setTimeout(r, 0));
    });
    // `busy` was given and says no, so the form's submit must not override it.
    expect(button.disabled).toBe(false);
  });
});
