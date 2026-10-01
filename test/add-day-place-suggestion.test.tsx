// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { resetNavigation } from "./fixtures/fakeNavigation";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next/navigation", async () => (await import("./fixtures/fakeNavigation")).navigationMock("/@alex/studio/day/new"));

/**
 * B2646 — the route's place suggestion ("You were in Zürich — use it?").
 * Opening "Add a place" shows it inside the panel, once; "Use it" fills the
 * place and closes the panel.
 */

const { default: AddDayFlow } = await import("@/components/studio/day/AddDayFlow");
const { default: StudioBarProvider } = await import("@/components/studio/StudioBar");
const { default: LocaleProvider } = await import("@/components/LocaleProvider");
const { dictionaryFor } = await import("@/lib/locales");
const dict = dictionaryFor("en");

let root: Root | undefined;
let container: HTMLDivElement;
afterEach(() => {
  vi.unstubAllGlobals();
  act(() => root?.unmount());
  container?.remove();
  sessionStorage.clear();
  localStorage.clear();
  resetNavigation();
});

test("Use it fills the place and closes the panel", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.includes("/day/place") ? Response.json({ ok: true, place: { name: "Zürich", country: "Switzerland" } }) : Response.json({ media: [] }),
    ),
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root!.render(
      <LocaleProvider dictionary={dict} locale="en">
        <StudioBarProvider username="alex">
          <AddDayFlow
            username="alex"
            trips={[{ id: "ch", title: "Daily Updates", start: "2025-11-01", end: "2025-11-30" }]}
            writtenDatesByTrip={{ ch: ["2025-11-02"] }}
            proposal={{ trip: { id: "ch", title: "Daily Updates", status: "current" }, reasonKey: "studio.day.which.reasonCurrent", today: "2025-11-10" }}
            routeRecordingAvailable
          />
        </StudioBarProvider>
      </LocaleProvider>,
    ),
  );
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
  const text = () => container.textContent ?? "";
  const use = dict["studio.day.where.suggestion.use"];
  const buttons = () => Array.from(container.querySelectorAll("button"));

  await act(async () => (container.querySelector('[data-chip="place"]') as HTMLButtonElement).click());
  expect(text()).toContain(dict["studio.day.sheet.notRight"]);
  expect(buttons().filter((b) => b.textContent === use)).toHaveLength(1);

  await act(async () => buttons().find((b) => b.textContent === use)!.click());
  expect(text()).not.toContain(dict["studio.day.sheet.notRight"]);
  expect(container.querySelector('[data-chip="place"]')!.textContent).toContain("Zürich, Switzerland");
});
