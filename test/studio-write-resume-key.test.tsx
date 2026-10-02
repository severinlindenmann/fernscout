// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { resetNavigation } from "./fixtures/fakeNavigation";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", async () => (await import("./fixtures/fakeNavigation")).navigationMock("/@alex/studio/day/new"));
vi.mock("@/components/PageHeader", () => ({ default: () => <header /> }));

/**
 * B2676 — the resume-key bug named in the ticket: `DayFlow` used to mount
 * `AddDayFlow` with a flowId suffixed `:one` (or `:part-N`) for every part,
 * while `readAddDaySnapshot` (shared with the hub's own "Continue") always
 * read the plain, unsuffixed key — so a draft `DayFlow` had just written
 * was never the one the hub (or a reload of this same page) found.
 *
 * `DayFlow` no longer mounts anything per part at all (B2676, decision 7 —
 * parts are stacked inside `AddDayFlow` itself), so this proves the fix at
 * the level that matters: what `DayFlow` actually writes to
 * `sessionStorage` is exactly what `readAddDaySnapshot` reads back.
 */

const { default: DayFlow } = await import("@/components/studio/day/DayFlow");
const { default: StudioBarProvider } = await import("@/components/studio/StudioBar");
const { default: LocaleProvider } = await import("@/components/LocaleProvider");
const { dictionaryFor } = await import("@/lib/locales");
const { addDayStorageKey, readAddDaySnapshot } = await import("@/lib/studio/addDayResume");

const dict = dictionaryFor("en");
const TRIPS = [{ id: "reise", title: "Reise", start: "2025-11-01", end: "2025-11-30" }];

let root: Root | undefined;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.endsWith("/inbox")) return Response.json({ media: [] });
      if (url.includes("/day/for-date")) return Response.json({ ok: true, existing: null });
      return Response.json({ ok: true });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  sessionStorage.clear();
  localStorage.clear();
  resetNavigation();
});

async function flush() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

test("typing on the Write page is found by readAddDaySnapshot — the hub's own \"Continue\" reads this key", async () => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root!.render(
      <LocaleProvider dictionary={dict} locale="en">
        <StudioBarProvider username="alex">
          <DayFlow
            username="alex"
            trips={TRIPS}
            writtenDatesByTrip={{ reise: ["2025-11-02"] }}
            proposal={{ trip: { id: "reise", title: "Reise", status: "current" }, reasonKey: "studio.day.which.reasonCurrent", today: "2025-11-10" }}
          />
        </StudioBarProvider>
      </LocaleProvider>,
    ),
  );
  await flush();

  const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
    setter.call(textarea, "Our first day.");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await flush();

  // The bug: this used to be null — `DayFlow` wrote `studio:addDay:alex:one`
  // while this reads `studio:addDay:alex`.
  const snapshot = readAddDaySnapshot("alex");
  expect(snapshot).not.toBeNull();
  expect(snapshot?.content).toBe("Our first day.");
  // And the exact key a reload / the hub's own banner looks under.
  expect(sessionStorage.getItem(addDayStorageKey("alex"))).not.toBeNull();
});

describe("the flowId itself", () => {
  test("addDayFlowId has no per-part suffix any more", async () => {
    const { addDayFlowId } = await import("@/lib/studio/addDayResume");
    expect(addDayFlowId("alex")).toBe("addDay:alex");
    expect(addDayFlowId("alex")).not.toMatch(/:one$|:part-/);
  });
});

describe("a kept draft that has since been published (found in the browser, 2026-10-02)", () => {
  function mount() {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    return act(async () =>
      root!.render(
        <LocaleProvider dictionary={dict} locale="en">
          <StudioBarProvider username="alex">
            <DayFlow
              username="alex"
              trips={TRIPS}
              writtenDatesByTrip={{ reise: ["2025-11-02"] }}
              proposal={{ trip: { id: "reise", title: "Reise", status: "current" }, reasonKey: "studio.day.which.reasonCurrent", today: "2025-11-10" }}
            />
          </StudioBarProvider>
        </LocaleProvider>,
      ),
    );
  }

  test("is never written to again: the page starts over instead of PATCHing a published day", async () => {
    await mount();
    await flush();
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(textarea, "Yesterday's words.");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await flush();
    const key = addDayStorageKey("alex");
    const stored = JSON.parse(sessionStorage.getItem(key)!);
    const withSlug = JSON.stringify(stored).replace('"createdSlug":null', '"createdSlug":"2025-11-10"');
    expect(withSlug).toContain('"createdSlug":"2025-11-10"');
    act(() => root?.unmount());
    container.remove();
    sessionStorage.setItem(key, withSlug);

    const calls: Array<{ url: string; method: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, method: init?.method ?? "GET" });
        if (url.endsWith("/inbox")) return Response.json({ media: [] });
        if (url.includes("/day/for-date")) return Response.json({ ok: true, existing: null });
        if (url.includes("/day?trip=")) return Response.json({ ok: true, draft: { slug: "2025-11-10", published: true } });
        return Response.json({ ok: true });
      }),
    );
    await mount();
    await flush();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 2000));
    });
    await flush();

    expect(calls.filter((c) => c.method === "PATCH")).toEqual([]);
    expect((container.querySelector("textarea") as HTMLTextAreaElement).value).toBe("");
  });
});
