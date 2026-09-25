// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;


/**
 * B1937 — D7, proven where it actually lives: the decide screen's own DOM.
 *
 * "Keep it here, privately" starts selected and "throw it away" does not,
 * on every mount, with no click needed to get there. The commit request
 * carries `discard: false` unless a person taps the other card — this test
 * drives the flow through a real upload and a real peek (mocked fetches) to
 * check both the render and the wire.
 *
 * Since B2079 the flow keeps its step in `?step=`; `next/navigation` is a
 * stand-in with a history stack, and every click re-renders with the new URL
 * the way the app router would.
 */

let history: string[] = [""];
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: (href: string) => history.push(href.split("?")[1] ?? ""),
    back: () => history.length > 1 && history.pop(),
    replace: (href: string) => (history[history.length - 1] = href.split("?")[1] ?? ""),
  }),
  usePathname: () => "/alex/studio/location",
  useSearchParams: () => new URLSearchParams(history[history.length - 1]),
}));

const { default: LocationFlow } = await import("@/components/studio/location/LocationFlow");
const { default: StudioBarProvider } = await import("@/components/studio/StudioBar");
const { default: LocaleProvider } = await import("@/components/LocaleProvider");
const { dictionaryFor } = await import("@/lib/locales");

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function tree() {
  return (
    <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
      <StudioBarProvider username="alex">
        <LocationFlow
          username="alex"
          trips={[{ id: "alps-2024", title: "Alps 2024", start: "2026-06-22", end: "2026-06-24" }]}
          defaultTripId="alps-2024"
        />
      </StudioBarProvider>
    </LocaleProvider>
  );
}

beforeEach(() => {
  history = [""];
  sessionStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  vi.unstubAllGlobals();
});

function clickByText(tag: string, text: string) {
  const el = [...container!.querySelectorAll<HTMLElement>(tag)].find((e) => e.textContent?.trim() === text);
  if (!el) throw new Error(`not found: ${tag} "${text}"`);
  act(() => el.click());
  act(() => root!.render(tree()));
}

async function driveToDecide() {
  root = createRoot(container!);
  act(() => root!.render(tree()));

  clickByText("button", "Show me how to get it"); // what → getIt
  clickByText("button", "I have it"); // getIt → deliver

  const input = container!.querySelector<HTMLInputElement>('input[type="file"]')!;
  const file = new File(["{}"], "Timeline.json", { type: "application/json" });
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  act(() => input.dispatchEvent(new Event("change", { bubbles: true })));

  await act(async () => {
    clickByText("button", "Read the file");
  });
  // Let the two chained fetches (stage, then dryRun peek) resolve.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  act(() => root!.render(tree()));

  clickByText("button", "What happens to it"); // peek → decide
}

describe("D7 — keep is pre-selected on the decide screen", () => {
  test("the keep radio starts checked and discard does not, with no click needed", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/inbox") && init?.method === "POST") {
        return new Response(JSON.stringify({ ok: true, items: [{ id: "i1", filename: "Timeline.json" }] }), {
          status: 200,
        });
      }
      if (url.includes("/import")) {
        return new Response(
          JSON.stringify({
            ok: true,
            read: 40,
            from: "2026-06-22T08:00:00Z",
            to: "2026-06-22T09:00:00Z",
            extent: { minLat: 40, maxLat: 40.1, minLon: -30, maxLon: -29.9 },
            coverage: [{ tripId: "alps-2024", days: 1, tripDays: 3 }],
          }),
          { status: 200 },
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await driveToDecide();

    const radios = container!.querySelectorAll<HTMLInputElement>('input[type="radio"]');
    expect(radios).toHaveLength(2);
    const [keep, discard] = [...radios];
    expect(keep.checked).toBe(true);
    expect(discard.checked).toBe(false);

    // And the wire agrees: committing without touching either radio sends
    // `discard: false`.
    await act(async () => {
      clickByText("button", "Draw the track for Alps 2024");
    });
    const commitCall = fetchMock.mock.calls.find(([, init]) => {
      const body = (init as RequestInit | undefined)?.body;
      return typeof body === "string" && body.includes('"commit":true');
    });
    expect(commitCall).toBeDefined();
    const sentBody = JSON.parse((commitCall![1] as RequestInit).body as string);
    expect(sentBody.discard).toBe(false);
    expect(sentBody.trips).toEqual(["alps-2024"]);
  });
});

/** The same fetch stand-in as above, answering the commit with one drawn trip. */
function stubFetch() {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("/inbox") && init?.method === "POST") {
      return new Response(JSON.stringify({ ok: true, items: [{ id: "i1", filename: "Timeline.json" }] }), { status: 200 });
    }
    if (url.includes("/import") && String(init?.body).includes('"commit":true')) {
      return new Response(JSON.stringify({ ok: true, drawn: [{ tripId: "alps-2024", segments: 1, points: 40 }] }), {
        status: 200,
      });
    }
    if (url.includes("/import")) {
      return new Response(
        JSON.stringify({
          ok: true,
          read: 40,
          from: "2026-06-22T08:00:00Z",
          to: "2026-06-22T09:00:00Z",
          extent: { minLat: 40, maxLat: 40.1, minLon: -30, maxLon: -29.9 },
          coverage: [{ tripId: "alps-2024", days: 1, tripDays: 3 }],
        }),
        { status: 200 },
      );
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("LocationFlow on useStep — B2079, B2082", () => {
  test("without WhatsApp the send step promises one way, not two", () => {
    root = createRoot(container!);
    act(() => root!.render(tree()));
    expect(container!.textContent).toContain("1 of 5");
    clickByText("button", "Show me how to get it");
    clickByText("button", "I have it");
    expect(container!.textContent).toContain("3 of 5");
    expect(container!.textContent).toContain("Pick the file on this device.");
    expect(container!.textContent).not.toContain("Two ways");
  });

  test("Back from decide lands on the read, and a reload on decide keeps the read and the choice", async () => {
    stubFetch();
    await driveToDecide();
    expect(container!.textContent).toContain("5 of 5");
    act(() => container!.querySelectorAll<HTMLInputElement>('input[type="radio"]')[1].click());

    history.pop();
    act(() => root!.render(tree()));
    expect(container!.textContent).toContain("4 of 5");
    expect(container!.textContent).toContain("40 positions");

    clickByText("button", "What happens to it");
    act(() => root!.unmount());
    root = createRoot(container!);
    act(() => root!.render(tree()));
    expect(container!.textContent).toContain("5 of 5");
    expect(container!.querySelectorAll<HTMLInputElement>('input[type="radio"]')[1].checked).toBe(true);
    // The box around the history is never kept in the tab's storage.
    expect(sessionStorage.getItem("studio:location:alex")).not.toContain("minLat");
  });

  test("done links to the trip's map, has no back link of its own, and clears the step", async () => {
    stubFetch();
    await driveToDecide();
    await act(async () => {
      clickByText("button", "Draw the track for Alps 2024");
    });
    act(() => root!.render(tree()));
    expect(container!.querySelector('[role="status"]')?.textContent).toContain("Alps 2024 has a map now.");
    const hrefs = [...container!.querySelectorAll("a")].map((a) => a.getAttribute("href") ?? "");
    expect(hrefs).toContain("/alex/trips/alps-2024/map");
    // One way back: the studio bar's own link, and no second one in the body.
    expect(hrefs.filter((h) => h.startsWith("/alex/studio") && !h.includes("/studio/"))).toHaveLength(1);
    expect(history[history.length - 1]).toBe("");
    expect(sessionStorage.getItem("studio:location:alex")).toBeNull();
  });
});
