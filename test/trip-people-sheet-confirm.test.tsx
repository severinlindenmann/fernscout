// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { resetNavigation } from "./fixtures/fakeNavigation";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", async () => (await import("./fixtures/fakeNavigation")).navigationMock("/@alex/studio/trip"));

/**
 * B-2915 - inside the sheet's modal dialog the studio bottom bar is under the
 * overlay, so the figure creator confirms with buttons of its own.
 */
const { TripPeopleRow } = await import("@/components/studio/trip/TripPeopleSheet");
const { default: LocaleProvider } = await import("@/components/LocaleProvider");
const { dictionaryFor } = await import("@/lib/locales");

let root: Root;
let container: HTMLDivElement;
let calls: { url: string; method: string; body: unknown }[];

beforeEach(() => {
  calls = [];
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return new Response(JSON.stringify({ id: "alex", name: "Alex", person: "alex@example.test" }), { status: 200 });
    }),
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root.render(
      <LocaleProvider dictionary={dictionaryFor("en")} locale="en">
        <ul>
          <TripPeopleRow
            defaultOpen
            username="alex"
            tripId="t1"
            owner={{ name: "Alex", email: "alex@example.test" }}
            initialPeople={[]}
            contacts={[]}
            initialFigures={[]}
            figureSet={[]}
            photoConsent={false}
          />
        </ul>
      </LocaleProvider>,
    ),
  );
});

afterEach(() => {
  resetNavigation();
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const button = (text: string) => [...container.querySelectorAll("button")].find((b) => b.textContent?.includes(text));

describe("figure creator inside the sheet confirms inline", () => {
  async function keepWith(startLabel: string) {
    act(() => button("Add figure")!.click());
    act(() => button(startLabel)!.click());
    if (startLabel === "A look") act(() => container.querySelector<HTMLButtonElement>("button:has(img)")!.click());
    const next = button("Next")!;
    expect(next.disabled).toBe(false);
    expect(next.closest("dialog")).not.toBeNull();
    act(() => next.click());
    const save = button("Save Alex")!;
    expect(save.disabled).toBe(false);
    await act(async () => save.click());
  }

  for (const start of ["A look", "Plain"]) {
    test(`${start}: Next then Save keeps the figure and returns to the list`, async () => {
      await keepWith(start);
      const writes = calls.filter((c) => c.method !== "GET").map((c) => `${c.method} ${c.url}`);
      expect(writes).toEqual(["PUT /api/web/alex/figures/alex", "PATCH /api/web/alex/trips/t1/figures"]);
      expect(container.querySelector("#trip-people-title")).not.toBeNull();
      expect(container.querySelector("img[alt='Alex’s figure']")).not.toBeNull();
    });
  }

  test("the look confirm is disabled until a look is chosen", () => {
    act(() => button("Add figure")!.click());
    act(() => button("A look")!.click());
    expect(button("Next")!.disabled).toBe(true);
  });
});
