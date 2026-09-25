// @vitest-environment jsdom
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * B2065 — `useStep` keeps a wizard's step in `?step=` and its typed fields in
 * a session draft, so Back, a swipe or a reload no longer throws work away.
 * `next/navigation` is a stand-in whose URL the test moves by hand, the way
 * the browser's Back button would.
 */

let url = new URLSearchParams();
const push = vi.fn((href: string) => {
  url = new URLSearchParams(href.split("?")[1] ?? "");
});
const back = vi.fn();
const replace = vi.fn((href: string) => {
  url = new URLSearchParams(href.split("?")[1] ?? "");
});
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, back, replace }),
  usePathname: () => "/example/studio/reader/invite",
  useSearchParams: () => url,
}));

const { useStep } = await import("@/lib/studio/useStep");

const STEPS = ["what", "gather", "preview"] as const;
/** What the harness hands out, set from an effect so render stays pure. */
const out = {} as { api: ReturnType<typeof useStep<(typeof STEPS)[number]>>; setName: (n: string) => void };
let draftSets = 0;

function Harness() {
  const [name, set] = useState("");
  const api = useStep(STEPS, {
    flowId: "invite",
    // B2136 — "gather" cannot be passed without a name.
    complete: (s) => s !== "gather" || name !== "",
    draft: {
      get: () => ({ name }),
      set: (d) => {
        draftSets++;
        set(String(d.name ?? ""));
      },
    },
  });
  useEffect(() => {
    out.api = api;
    out.setName = set;
  }, [api]);
  return <p>{`${api.step}|${api.index}/${api.total}|${name}`}</p>;
}

let root: Root | undefined;
let container: HTMLDivElement;

function mount() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root!.render(<Harness />));
}
const rerender = () => act(() => root!.render(<Harness />));
const reload = () => {
  act(() => root!.unmount());
  container.remove();
  mount();
};

beforeEach(() => {
  url = new URLSearchParams();
  push.mockClear();
  back.mockClear();
  replace.mockClear();
  sessionStorage.clear();
  draftSets = 0;
});
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
});

describe("useStep", () => {
  test("no ?step, or an unknown one, is the first step; total is the array's length", () => {
    mount();
    expect(container.textContent).toBe("what|0/3|");
    url = new URLSearchParams("step=nonsense");
    rerender();
    expect(container.textContent).toBe("what|0/3|");
  });

  test("next() pushes ?step= and the browser's Back lands on the step before", () => {
    mount();
    act(() => out.api.next());
    expect(push).toHaveBeenLastCalledWith("/example/studio/reader/invite?step=gather");
    rerender();
    act(() => out.setName("Marta")); // gather's required answer (B2136)
    act(() => out.api.next());
    expect(push).toHaveBeenLastCalledWith("/example/studio/reader/invite?step=preview");
    rerender();
    expect(container.textContent).toMatch(/^preview\|2\/3/);
    // Back: the browser pops one entry, the URL says gather again.
    url = new URLSearchParams("step=gather");
    rerender();
    expect(container.textContent).toMatch(/^gather\|1\/3/);
  });

  test("B2136: a deep link past an unanswered required step is clamped to it, URL included", () => {
    url = new URLSearchParams("step=preview");
    mount();
    expect(container.textContent).toBe("gather|1/3|");
    expect(replace).toHaveBeenLastCalledWith("/example/studio/reader/invite?step=gather");
    expect(url.get("step")).toBe("gather");
  });

  test("B2136: the clamp waits for the draft, so a reload with the answer stays put", () => {
    sessionStorage.setItem("studio:invite", JSON.stringify({ name: "Marta" }));
    url = new URLSearchParams("step=preview");
    mount();
    expect(container.textContent).toBe("preview|2/3|Marta");
    expect(replace).not.toHaveBeenCalled();
  });

  test("a reload on ?step=preview restores the step and the typed draft, once", () => {
    url = new URLSearchParams("step=gather");
    mount();
    act(() => out.setName("Marta"));
    expect(JSON.parse(sessionStorage.getItem("studio:invite")!)).toEqual({ name: "Marta" });
    url = new URLSearchParams("step=preview");
    reload();
    expect(container.textContent).toBe("preview|2/3|Marta");
    rerender();
    expect(draftSets).toBe(1);
  });

  test("reset() clears the stored draft and it stays cleared", () => {
    mount();
    act(() => out.setName("Marta"));
    expect(sessionStorage.getItem("studio:invite")).not.toBeNull();
    act(() => out.api.reset());
    rerender();
    expect(sessionStorage.getItem("studio:invite")).toBeNull();
    reload();
    expect(container.textContent).toBe("what|0/3|");
  });

  test("storage that throws does not break the flow", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    mount();
    act(() => out.setName("Marta"));
    expect(container.textContent).toBe("what|0/3|Marta");
    spy.mockRestore();
  });
});
