// @vitest-environment jsdom
//
// B2763 — a step of writing a day shows Back + primary only (no groups ^);
// other studio subpages keep it. B2765 — PublishedDay's headline, zero-reader
// line and roomy rows.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import StudioBarProvider from "@/components/studio/StudioBar";
import StudioPage from "@/components/studio/StudioPage";
import PublishedDay from "@/components/studio/day/PublishedDay";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("@/components/PageHeader", () => ({ default: () => <header /> }));

let root: Root | undefined;
let container: HTMLDivElement | undefined;
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

function render(node: React.ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
        <StudioBarProvider username="alex">{node}</StudioBarProvider>
      </LocaleProvider>,
    );
  });
  return container;
}

describe("B2763 groups button", () => {
  test("absent on a day page, present on another studio subpage", () => {
    const day = render(<StudioPage username="alex" group="write" hideGroups title="A day" />);
    expect(day.querySelector("[data-group-sheet]")).toBeNull();
    expect(day.querySelector('a[href="/@alex/studio#write"]')).not.toBeNull();
    act(() => root?.unmount());
    container?.remove();
    const loc = render(<StudioPage username="alex" group="write" title="Location" />);
    expect(loc.querySelector("[data-group-sheet]")).not.toBeNull();
  });
});

describe("B2765 PublishedDay", () => {
  test("headline, reader line, 44px link and roomy rows", () => {
    const el = render(<PublishedDay username="alex" tripId="t" slug="d" title="Sunday" readerLine="It's on your journal." thumb={null} reach={[]} />);
    expect(el.textContent).toContain("Published");
    expect(el.textContent).toContain("Sunday");
    expect(el.querySelector(".h-\\[120px\\]")).toBeNull(); // no thumb, no preview area
    expect(el.textContent).toContain("It's on your journal.");
    expect(el.querySelector("a.min-h-11")?.textContent).toBe("See the day");
    const rows = [...el.querySelectorAll(".divide-y > *")];
    expect(rows).toHaveLength(3);
    for (const r of rows) expect(r.className).toContain("py-[18px]");
    act(() => root?.unmount());
    container?.remove();
    const withThumb = render(<PublishedDay username="alex" tripId="t" slug="d" title="Sunday" readerLine="x" thumb="/t?look=photo" reach={[]} />);
    expect(withThumb.querySelector(".h-\\[120px\\] img")).not.toBeNull();
  });

  test("B2776 — Send the link only when someone can open the day; otherwise the two doors", () => {
    const open = render(<PublishedDay username="alex" tripId="t" slug="d" title="Sunday" readerLine="x" thumb={null} reach={[]} />);
    expect(open.textContent).toContain("Send the link");
    act(() => root?.unmount());
    container?.remove();
    const closed = render(
      <PublishedDay
        username="alex"
        tripId="t"
        slug="d"
        title="Sunday"
        readerLine="x"
        thumb={null}
        reach={[
          { key: "studio.reach.addSomeone", href: "/@alex/studio/people" },
          { key: "studio.reach.letReadersIn", href: "/@alex/studio/trip/visibility?trip=t" },
        ]}
      />,
    );
    expect(closed.textContent).not.toContain("Send the link");
    expect(closed.textContent).toContain("Add someone to this trip");
    expect(closed.querySelector('a[href="/@alex/studio/trip/visibility?trip=t"]')?.textContent).toContain("Let your readers in");
  });

  test("zero-reader string never says 'Your 0 readers'", () => {
    const d = dictionaryFor("en");
    // B2776 — no longer "send the link": nobody else can open a closed trip.
    expect(d["studio.published.toldOnlyYou"]).toMatch(/Only you can open it/);
    expect(d["studio.published.toldOnlyYou"]).not.toMatch(/\b0\b/);
  });
});
