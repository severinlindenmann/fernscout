// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { resetNavigation } from "./fixtures/fakeNavigation";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", async () => (await import("./fixtures/fakeNavigation")).navigationMock("/alex/studio/day/new"));

/**
 * B2184 — a failed save shows plain sentences, never the response body.
 *
 * B2188 took the "draft this from my notes" box out of "Add a day" (owner
 * decision: AI is a button, not a field — "Polish my text", B2190). The
 * write-day error sentences this file also pinned moved with it: they are
 * `PolishText`'s to prove, on B2190's branch.
 */

const { default: AddDayFlow } = await import("@/components/studio/day/AddDayFlow");
const { default: StudioBarProvider } = await import("@/components/studio/StudioBar");
const { default: LocaleProvider } = await import("@/components/LocaleProvider");
const { dictionaryFor } = await import("@/lib/locales");
const TODAY = "2025-11-10";
const TRIPS = [{ id: "reise", title: "Reise", start: "2025-11-01", end: "2025-11-30" }];

let root: Root | undefined;
let container: HTMLDivElement;
let dayNewResponse: () => Response;

beforeEach(() => {
  dayNewResponse = () => Response.json({ ok: true, slug: `${TODAY}-a-day` });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/inbox")) return Response.json({ media: [] });
      if (url.includes("/day/new") && init?.method === "POST") return dayNewResponse();
      return Response.json({});
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  sessionStorage.clear();
  resetNavigation();
});

function tree() {
  return (
    <LocaleProvider dictionary={dictionaryFor("en")} locale="en">
      <StudioBarProvider username="alex">
        <AddDayFlow
          username="alex"
          trips={TRIPS}
          writtenDatesByTrip={{ reise: ["2025-11-02"] }}
          proposal={{ trip: { id: "reise", title: "Reise", status: "current" }, reasonKey: "studio.day.which.reasonCurrent", today: TODAY }}
        />
      </StudioBarProvider>
    </LocaleProvider>
  );
}
async function mount() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(tree()));
  await flush();
}
async function flush() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}
function button(text: string): HTMLButtonElement {
  // The bar's primary renders outside the flow's own container.
  const b = Array.from(document.querySelectorAll("button")).find((x) => x.textContent?.trim() === text);
  if (!b) throw new Error(`no button ${JSON.stringify(text)} in: ${container.textContent}`);
  return b;
}
async function click(text: string) {
  await act(async () => button(text).click());
  await flush();
}
const text = () => container.textContent ?? "";

describe("AddDayFlow write failures show sentences, never JSON — B2184", () => {
  test("invalid_media names the file and the problem, in words", async () => {
    dayNewResponse = () =>
      Response.json(
        {
          error: "invalid_media",
          detail: {
            ok: false,
            error: "invalid_media",
            problems: [{ field: "IMG_6178.jpeg.dimensions", got: "8064px", expected: "at most 8000px on the longest edge" }],
          },
        },
        { status: 400 },
      );
    await mount();
    await click("Save privately");
    expect(text()).toContain("IMG_6178.jpeg is too large (8064px)");
    expect(text()).toContain("at most 8000px on the longest edge");
    expect(text()).not.toContain("{");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("The day was not made.");
  });

  test("any other write failure shows the plain message, never the response body", async () => {
    dayNewResponse = () => Response.json({ error: "day_write_failed", detail: { ok: false, stack: "at createDraft (…)" } }, { status: 400 });
    await mount();
    await click("Save privately");
    expect(text()).not.toContain("{");
    expect(text()).not.toContain("stack");
    expect(text()).toContain("Nothing at all was written");
  });
});
