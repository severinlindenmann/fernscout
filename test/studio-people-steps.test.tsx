// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * B2079 — "Who was there" on `useStep`. The type-in path counts 1, 2, 3, 4
 * (it used to jump 2 → none → 5), Back and a reload keep the typed names,
 * and done is `DoneScreen` with the step cleared from the URL.
 * `next/navigation` is a stand-in with a real history stack.
 */

let history: string[] = [""];
const current = () => new URLSearchParams(history[history.length - 1]);
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: (href: string) => history.push(href.split("?")[1] ?? ""),
    back: () => history.length > 1 && history.pop(),
    replace: (href: string) => (history[history.length - 1] = href.split("?")[1] ?? ""),
  }),
  usePathname: () => "/alex/studio/people",
  useSearchParams: () => current(),
}));

const { default: PeopleFlow } = await import("@/components/studio/people/PeopleFlow");
const { default: StudioBarProvider } = await import("@/components/studio/StudioBar");
const { default: LocaleProvider } = await import("@/components/LocaleProvider");
const { dictionaryFor } = await import("@/lib/locales");

let root: Root | undefined;
let container: HTMLDivElement;

function tree() {
  return (
    <LocaleProvider dictionary={dictionaryFor("en")} locale="en">
      <StudioBarProvider username="alex">
        <PeopleFlow
          username="alex"
          trips={[{ id: "alps", title: "Alps" }]}
          defaultTripId="alps"
          photoConsent={false}
          photoCredits={0}
        />
      </StudioBarProvider>
    </LocaleProvider>
  );
}
function mount() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root!.render(tree()));
}
const rerender = () => act(() => root!.render(tree()));
const reload = () => {
  act(() => root!.unmount());
  container.remove();
  mount();
};
const browserBack = () => {
  history.pop();
  rerender();
};

function type(el: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}
function button(text: string): HTMLButtonElement {
  const b = Array.from(container.querySelectorAll("button")).find((x) => x.textContent?.trim() === text);
  if (!b) throw new Error(`no button ${JSON.stringify(text)} in: ${container.textContent}`);
  return b;
}
const click = (text: string) => {
  act(() => button(text).click());
  rerender();
};
const counter = () => container.textContent?.match(/(\d) of (\d)/)?.slice(1).join("/") ?? null;

function typeOnePerson() {
  const name = container.querySelector('input[type="text"]') as HTMLInputElement;
  const email = container.querySelector('input[type="email"]') as HTMLInputElement;
  act(() => {
    type(name, "Test Person");
    type(email, "test-w4c@fernscout.ch");
  });
}

beforeEach(() => {
  history = [""];
  sessionStorage.clear();
});
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  vi.unstubAllGlobals();
});

describe("PeopleFlow on useStep — B2079", () => {
  test("the type-in path counts 1, 2, 3, 4 with nothing skipped", () => {
    mount();
    const seen = [counter()];
    click("Show me how to get the card");
    seen.push(counter());
    click("Type the people in instead");
    expect(current().get("step")).toBe("bring");
    seen.push(counter());
    typeOnePerson();
    click("Continue");
    expect(current().get("step")).toBe("decide");
    seen.push(counter());
    expect(seen).toEqual(["1/4", "2/4", "3/4", "4/4"]);
  });

  test("B2136: the type-in screen is ?mode=type, and a reload with no draft stays on it", () => {
    mount();
    click("Show me how to get the card");
    click("Type the people in instead");
    expect(current().get("mode")).toBe("type");
    sessionStorage.clear();
    reload();
    expect(container.querySelector('input[type="email"]')).not.toBeNull();
    expect(container.querySelector('input[type="file"]')).toBeNull();
  });

  test("Back from decide and a reload both keep the typed person", () => {
    mount();
    click("Show me how to get the card");
    click("Type the people in instead");
    typeOnePerson();
    click("Continue");
    expect(container.textContent).toContain("test-w4c@fernscout.ch");

    browserBack();
    expect(current().get("step")).toBe("bring");
    expect((container.querySelector('input[type="text"]') as HTMLInputElement).value).toBe("Test Person");

    reload();
    expect(counter()).toBe("3/4");
    expect((container.querySelector('input[type="email"]') as HTMLInputElement).value).toBe("test-w4c@fernscout.ch");
  });

  test("done is a DoneScreen, the draft is gone and the step is cleared", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        String(url).endsWith("/figures")
          ? new Response(JSON.stringify({ figures: [{ id: "f1", person: "test-w4c@fernscout.ch" }] }), { status: 200 })
          : new Response(JSON.stringify({ filed: 1, invalid: 0, results: [] }), { status: 200 }),
      ),
    );
    mount();
    await act(async () => {});
    click("Show me how to get the card");
    click("Type the people in instead");
    typeOnePerson();
    click("Continue");
    await act(async () => {
      button("Add and send the confirmations").click(); // B2088: count moved to the body line
    });
    rerender();
    expect(container.querySelector('[role="status"]')?.textContent).toContain("1 person added");
    expect(Array.from(container.querySelectorAll("a")).some((a) => a.getAttribute("href") === "/alex/studio/people")).toBe(true);
    expect(sessionStorage.getItem("studio:people:alex")).toBeNull();
    expect(current().get("step")).toBeNull();
  });
});
