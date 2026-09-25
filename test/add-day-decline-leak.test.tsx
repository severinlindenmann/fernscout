// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import { resetNavigation } from "./fixtures/fakeNavigation";
import AddDayFlow from "@/components/studio/day/AddDayFlow";
import StudioBarProvider from "@/components/studio/StudioBar";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", async () => (await import("./fixtures/fakeNavigation")).navigationMock("/alex/studio/day/new"));

/**
 * B1899 — a reason typed for one field leaked into every other declined
 * field, because the decline screen's state outlived the field it was for.
 * The claim under test was always what gets WRITTEN: nothing in `declined`
 * that this person did not say about that field.
 *
 * Since B2188 "Add a day" asks no decline at all (D1 as amended by B2191:
 * blanks are named at share time), so the strongest form of that claim is
 * now: an answered field is written as an answer, and the write carries no
 * reason whatsoever — not a copied one, not a default one. `DeclineScreen`
 * itself still has its own leak keeper, `test/edit-day-decline-leak.test.tsx`.
 */

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
  resetNavigation();
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

function setInputValue(el: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("AddDayFlow — B1899, nothing is declined that the person did not decline", () => {
  test("a place typed in is written as the place, and no field carries a reason", async () => {
    let commitBody: Record<string, unknown> | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("/inbox")) return Response.json({ media: [] });
        if (url.includes("/day/new")) {
          commitBody = JSON.parse(String(init?.body ?? "{}"));
          return Response.json({ ok: true, slug: "2025-11-10-a-day" }, { status: 201 });
        }
        return Response.json({});
      }),
    );

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <LocaleProvider dictionary={dictionaryFor("en")} locale="en">
          <StudioBarProvider username="alex">
            <AddDayFlow
              username="alex"
              trips={[{ id: "reise", title: "Reise", start: "2025-01-01", end: "2025-12-31" }]}
              writtenDatesByTrip={{ reise: ["2025-01-02"] }}
              proposal={{ trip: { id: "reise", title: "Reise", status: "current" }, reasonKey: "studio.day.which.reasonCurrent", today: "2025-11-10" }}
            />
          </StudioBarProvider>
        </LocaleProvider>,
      );
    });
    const c = container!;
    await act(async () => (c.querySelector('[data-chip="place"]') as HTMLButtonElement).click());
    await act(async () => {
      setInputValue(c.querySelector('input[name="location"]') as HTMLInputElement, "Lisbon");
    });
    await act(async () => {
      setInputValue(c.querySelector('input[name="country"]') as HTMLInputElement, "Portugal");
    });
    const save = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Save privately")!;
    await act(async () => save.click());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(commitBody).not.toBeNull();
    const body = commitBody as unknown as { location: string; country: string; declined: Record<string, string> };
    expect(body.location).toBe("Lisbon");
    expect(body.country).toBe("Portugal");
    expect(body.declined).toEqual({});
  });
});
