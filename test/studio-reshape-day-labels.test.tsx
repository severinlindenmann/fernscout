// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import { currentSearch, navigationMock, resetNavigation } from "./fixtures/fakeNavigation";
import ReshapeDayFlow from "@/components/studio/day/ReshapeDayFlow";
import LocaleProvider from "@/components/LocaleProvider";
import StudioBarProvider from "@/components/studio/StudioBar";
import { dictionaryFor } from "@/lib/locales";
import type { EditablePickerTrip } from "@/lib/studio/editDay";

// B2136 — reshape and the figure creator keep their step in the URL (`useStep`).
vi.mock("next/navigation", async () => (await import("./fixtures/fakeNavigation")).navigationMock("/alex/studio/day/reshape"));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * B2080 — the rendered half of "Something is filed wrong" (the writes are
 * `paid/test/studio-reshape-day.test.ts`): every counted screen reads "n of 4 ·
 * <phrase>", the move's target screen no longer says "which of the three",
 * the AFTER card keeps the photograph count the NOW card shows, and a
 * picker row's time is its own word ("car park 21:40", not "car park21:40").
 */

const PICKER: EditablePickerTrip[] = [
  {
    tripId: "portugal",
    tripTitle: "Portugal",
    days: [{ date: "2025-11-15", entries: [{ slug: "car-park", title: "car park", time: "21:40", status: "draft" }] }],
  },
];

let root: Root | undefined;
let container: HTMLDivElement;

afterEach(() => {
  resetNavigation();
  act(() => root?.unmount());
  container?.remove();
  vi.unstubAllGlobals();
});

function button(text: string): HTMLButtonElement {
  const b = Array.from(container.querySelectorAll("button")).find((x) => x.textContent?.trim().startsWith(text));
  if (!b) throw new Error(`no button ${JSON.stringify(text)} in: ${container.textContent}`);
  return b;
}
async function click(text: string) {
  await act(async () => button(text).click());
}
const label = () => container.querySelector(".font-mono")?.textContent ?? null;

describe("ReshapeDayFlow — move, B2080", () => {
  test("labels read 'n of 4', the target screen is not 'which of the three', AFTER keeps the photo count", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          tripId: "portugal",
          tripTitle: "Portugal",
          slug: "2025-11-15-car-park",
          title: "car park",
          date: "2025-11-15",
          time: "21:40",
          content: "",
          media: [{ src: "/a.jpg" }, { src: "/b.jpg" }],
          published: false,
        }),
      ),
    );
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() =>
      root!.render(
        <LocaleProvider dictionary={dictionaryFor("en")} locale="en">
          <StudioBarProvider username="alex">
            <ReshapeDayFlow username="alex" picker={PICKER} trips={[{ id: "portugal", title: "Portugal" }]} />
          </StudioBarProvider>
        </LocaleProvider>,
      ),
    );

    await click("Choose what's wrong");
    expect(label()).toBe("1 of 4 · what went wrong");
    await click("Move a day");
    expect(label()).toBe("2 of 4 · which day");
    expect(container.textContent).toContain("car park 21:40");
    await click("car park");
    expect(label()).toBe("3 of 4 · where to");
    await click("See what this moves");
    expect(label()).toBe("4 of 4 · before and after");

    const cards = Array.from(container.querySelectorAll(".rounded-xl.border")).map((c) => c.textContent ?? "");
    const [now, after] = cards;
    expect(now).toContain("2 photographs");
    expect(after).toContain("2 photographs");

    // B2136 — the step is in the URL: the browser's Back is the step before.
    expect(currentSearch()).toBe("step=preview");
    act(() => navigationMock("").useRouter().back());
    expect(label()).toBe("3 of 4 · where to");
    act(() => navigationMock("").useRouter().back());
    expect(label()).toBe("2 of 4 · which day");
  });

  test("B2136: a reload on ?step=preview re-fetches the chosen day from the draft", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ...DAY })));
    sessionStorage.setItem(
      "studio:reshape:alex",
      JSON.stringify({ operation: "move", slugA: DAY.slug, toTripId: "portugal", toDate: "2025-11-16" }),
    );
    resetNavigation("step=preview");
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () =>
      root!.render(
        <LocaleProvider dictionary={dictionaryFor("en")} locale="en">
          <StudioBarProvider username="alex">
            <ReshapeDayFlow username="alex" picker={PICKER} trips={[{ id: "portugal", title: "Portugal" }]} />
          </StudioBarProvider>
        </LocaleProvider>,
      ),
    );
    await act(async () => {});
    expect(currentSearch()).toBe("step=preview");
    expect(label()).toBe("4 of 4 · before and after");
    expect(container.textContent).toContain("car park");
    sessionStorage.clear();
  });

  test("B2136: a deep link to ?step=preview with nothing chosen lands on what went wrong", async () => {
    resetNavigation("step=preview");
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () =>
      root!.render(
        <LocaleProvider dictionary={dictionaryFor("en")} locale="en">
          <StudioBarProvider username="alex">
            <ReshapeDayFlow username="alex" picker={PICKER} trips={[{ id: "portugal", title: "Portugal" }]} />
          </StudioBarProvider>
        </LocaleProvider>,
      ),
    );
    expect(currentSearch()).toBe("step=pickOperation");
    expect(label()).toBe("1 of 4 · what went wrong");
  });

  // B2137 — the preview is the one ask: its confirm writes, no "Looks right"
  // in front of a second "Move it?" screen.
  test("a move with nothing to sweep asks once, on the preview", async () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url) =>
      url.includes("sweep=1")
        ? Response.json({ rows: [] })
        : Response.json({
            tripId: "portugal", tripTitle: "Portugal", slug: "2025-11-15-car-park", title: "car park",
            date: "2025-11-15", time: "21:40", content: "", media: [], published: false,
          }),
    );
    vi.stubGlobal("fetch", fetchMock);
    resetNavigation("");
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() =>
      root!.render(
        <LocaleProvider dictionary={dictionaryFor("en")} locale="en">
          <StudioBarProvider username="alex">
            <ReshapeDayFlow username="alex" picker={PICKER} trips={[{ id: "portugal", title: "Portugal" }]} />
          </StudioBarProvider>
        </LocaleProvider>,
      ),
    );
    await click("Choose what's wrong");
    await click("Move a day");
    await click("car park");
    await click("See what this moves");
    expect(container.textContent).not.toContain("Looks right");
    expect(container.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    await click("Move it");
    const posts = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST");
    expect(posts).toHaveLength(1);
  });
});

const DAY = {
  tripId: "portugal",
  tripTitle: "Portugal",
  slug: "2025-11-15-car-park",
  title: "car park",
  date: "2025-11-15",
  time: "21:40",
  content: "",
  media: [{ src: "/a.jpg" }],
  published: false,
};
