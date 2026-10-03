// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** B2303 — the "Days without a place" section's own DOM: a published day starts unticked, one tap sends only the ticked dates. */
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

const { default: NameDaysPanel } = await import("@/components/studio/location/NameDaysPanel");
const { default: LocaleProvider } = await import("@/components/LocaleProvider");
const { dictionaryFor } = await import("@/lib/locales");

let root: Root | undefined;
afterEach(() => {
  act(() => root?.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("NameDaysPanel", () => {
  test("published day unticked and marked, fill sends only the ticked dates", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, filled: ["2026-03-03"] })));
    vi.stubGlobal("fetch", fetchMock);
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
          <NameDaysPanel
            username="alex"
            tripId="laos"
            rows={[
              { date: "2026-03-03", place: "Chiang Mai, Thailand", published: false },
              { date: "2026-03-05", place: "Luang Prabang, Laos", published: true },
            ]}
          />
        </LocaleProvider>,
      );
    });
    const boxes = [...container.querySelectorAll<HTMLInputElement>("input[type=checkbox]")];
    expect(boxes.map((b) => b.checked)).toEqual([true, false]);
    expect(container.textContent).toContain("Published");
    expect(container.textContent).toContain("Chiang Mai, Thailand");
    const button = container.querySelector<HTMLButtonElement>("button")!;
    expect(button.textContent).toBe("Give 1 day a place");
    await act(async () => button.click());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/helper/alex/gps/name-days");
    expect(JSON.parse(init.body as string)).toEqual({ trip: "laos", dates: ["2026-03-03"] });
  });
});
