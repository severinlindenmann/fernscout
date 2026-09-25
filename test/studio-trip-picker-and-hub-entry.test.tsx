// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import { STUDIO_GROUPS } from "@/lib/studio/groups";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * B2141 — moving around the studio: every trip picker filters as you type,
 * a flow opened from the hub (`?from=hub`) starts on its first real step
 * while a direct link still shows the intro, and the bar's chevron beside
 * "← Studio" lists the six groups.
 */

let query = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/alex/studio/people",
  useSearchParams: () => new URLSearchParams(query),
}));
vi.mock("@/components/PageHeader", () => ({ default: () => <header /> }));

const { default: TripPicker } = await import("@/components/studio/trip/TripPicker");
const { default: PeopleFlow } = await import("@/components/studio/people/PeopleFlow");
const { default: StudioBarProvider } = await import("@/components/studio/StudioBar");
const { default: StudioPage } = await import("@/components/studio/StudioPage");
const { default: LocaleProvider } = await import("@/components/LocaleProvider");
const { dictionaryFor } = await import("@/lib/locales");

let root: Root | undefined;
let container: HTMLDivElement;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  query = "";
  sessionStorage.clear();
});

function render(node: React.ReactNode) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root!.render(
      <LocaleProvider dictionary={dictionaryFor("en")} locale="en">
        <StudioBarProvider username="alex">{node}</StudioBarProvider>
      </LocaleProvider>,
    ),
  );
  return container;
}

function type(el: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
  act(() => el.dispatchEvent(new Event("input", { bubbles: true })));
}

describe("TripPicker", () => {
  const trips = [
    { id: "japan-2025", title: "Three weeks in Japan" },
    { id: "alps", title: "Four days round the Alps" },
    { id: "portugal", title: "Portugal by train" },
  ];

  test("filters by search as you type, on title or address", () => {
    const el = render(<TripPicker base="/alex/studio/trip" trips={trips} />);
    const titles = () => [...el.querySelectorAll("ul a")].map((a) => a.getAttribute("href"));
    expect(titles()).toHaveLength(3);
    const box = el.querySelector<HTMLInputElement>('input[type="search"]')!;
    type(box, "JAPAN");
    expect(titles()).toEqual(["/alex/studio/trip?trip=japan-2025"]);
    type(box, "alps");
    expect(titles()).toEqual(["/alex/studio/trip?trip=alps"]);
    type(box, "nowhere");
    expect(titles()).toEqual([]);
    expect(el.textContent).toContain("No trip matches that.");
  });

  test("a search reaches past 'Show more'", () => {
    const el = render(<TripPicker base="/x" trips={trips} shownByDefault={1} />);
    expect(el.querySelectorAll("ul a")).toHaveLength(1);
    type(el.querySelector<HTMLInputElement>('input[type="search"]')!, "portugal");
    expect([...el.querySelectorAll("ul a")].map((a) => a.textContent)).toEqual(["Portugal by train/portugal"]);
  });
});

describe("?from=hub", () => {
  const people = () => (
    <PeopleFlow username="alex" trips={[{ id: "alps", title: "Alps" }]} defaultTripId="alps" photoConsent={false} photoCredits={0} />
  );
  const counter = () => container.textContent?.match(/(\d) of (\d)/)?.slice(1).join("/") ?? null;

  test("from the hub, the flow starts at step 2", () => {
    query = "from=hub";
    render(people());
    expect(counter()).toBe("2/4");
  });

  test("a direct link still shows the intro", () => {
    render(people());
    expect(counter()).toBe("1/4");
  });
});

describe("the bar's group sheet", () => {
  test("lists the six groups, each a link to its hub section", () => {
    const el = render(<StudioPage username="alex" group="plan" title="Edit a trip" />);
    const sheet = el.querySelector("details[data-group-sheet]")!;
    expect(sheet.querySelector("summary")!.getAttribute("aria-label")).toBe("All studio groups");
    expect([...sheet.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual(
      STUDIO_GROUPS.map((g) => `/alex/studio#${g}`),
    );
    // Escape closes it.
    act(() => {
      (sheet as HTMLDetailsElement).open = true;
      sheet.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect((sheet as HTMLDetailsElement).open).toBe(false);
  });
});
