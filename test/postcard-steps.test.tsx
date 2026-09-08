// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import PostcardSteps from "@/app/[user]/postcards/[id]/PostcardSteps";

/**
 * B1005 — Look, Write, Send, and the promise that the stepper is an
 * enhancement rather than the only way through.
 *
 * The property worth a test is not "clicking a tab changes a tab": it is that
 * **the server's HTML holds all three panels, none of them hidden and no bar
 * above them**, so a browser that never runs this component still shows the
 * whole flow in one scroll. That one is asserted against `renderToStaticMarkup`
 * rather than against the DOM, because the browser tests below have already
 * hydrated by the time they look — `stepped` is turned on by an effect, and
 * an effect is the thing a no-JavaScript reader never gets.
 *
 * The second is that a hidden panel is still *there*: `PostcardBack` saves on
 * a 700ms debounce and an unmount inside that window would take the last
 * keystrokes with it, so a step change must hide rather than remove.
 */

let root: Root | undefined;
let container: HTMLDivElement | undefined;

const STRINGS = {
  labels: { look: "Look", write: "Write", send: "Send", of: "of" },
  next: { look: "Looks right", write: "Ready to send" },
  back: "Back a step",
};

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = undefined;
  root = undefined;
});

function mount(props: Partial<React.ComponentProps<typeof PostcardSteps>> = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <PostcardSteps
        lookPanel={<p>the photograph</p>}
        writePanel={<p>the words</p>}
        sendPanel={<p>the button</p>}
        {...STRINGS}
        {...props}
      />,
    );
  });
}

/** Visible to a reader: rendered, and not inside a `hidden` subtree. */
function shows(text: string): boolean {
  const node = [...container!.querySelectorAll("p")].find(
    (p) => p.textContent === text,
  );
  return Boolean(node && !node.closest("[hidden]"));
}

describe("with no JavaScript, which is what the server renders", () => {
  const html = renderToStaticMarkup(
    <PostcardSteps
      lookPanel={<p>the photograph</p>}
      writePanel={<p>the words</p>}
      sendPanel={<p>the button</p>}
      {...STRINGS}
    />,
  );

  test("all three panels are there, and none of them is hidden", () => {
    for (const text of ["the photograph", "the words", "the button"]) {
      expect(html).toContain(text);
    }
    expect(html).not.toContain("hidden");
  });

  test("there is no step bar to press, so nothing promises what it cannot do", () => {
    expect(html).not.toContain("<nav");
    expect(html).not.toContain("Looks right");
  });

  test("each panel keeps a heading, since the bar is not there to name it", () => {
    expect(html).toContain("Look");
    expect(html).toContain("Write");
    expect(html).toContain("Send");
    expect(html).not.toContain("sr-only");
  });
});

describe("the three steps", () => {
  test("every panel is in the DOM, whichever step is showing", () => {
    mount();
    for (const text of ["the photograph", "the words", "the button"]) {
      expect(container!.textContent).toContain(text);
    }
  });

  test("one at a time once the stepper has taken over", () => {
    mount();
    expect(shows("the photograph")).toBe(true);
    expect(shows("the words")).toBe(false);
    expect(shows("the button")).toBe(false);
  });

  test("the forward button moves on without unmounting what came before", () => {
    mount();
    const forward = [...container!.querySelectorAll("button")].find(
      (b) => b.textContent === "Looks right",
    )!;
    act(() => forward.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(shows("the words")).toBe(true);
    expect(shows("the photograph")).toBe(false);
    // Hidden, not gone — an unmount here would throw away a debounced save.
    expect(container!.textContent).toContain("the photograph");
  });

  test("a step can be jumped to from the bar, in either direction", () => {
    mount();
    const tab = (name: string) =>
      [...container!.querySelectorAll("nav button")].find((b) =>
        b.textContent?.includes(name),
      )!;
    act(() => tab("Send").dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(shows("the button")).toBe(true);
    act(() => tab("Look").dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(shows("the photograph")).toBe(true);
  });

  test("a reader coming back from a form post lands on the step they pressed in", () => {
    mount({ start: "send" });
    expect(shows("the button")).toBe(true);
  });

  test("a sent order opens on the outcome rather than on the cropping", () => {
    mount({ settled: true });
    expect(shows("the button")).toBe(true);
  });

  test("the send step offers no forward button — the send is the forward", () => {
    mount({ start: "send" });
    const labels = [...container!.querySelectorAll("button")].map((b) => b.textContent);
    expect(labels).not.toContain("Ready to send");
    expect(labels).toContain("Back a step");
  });
});
