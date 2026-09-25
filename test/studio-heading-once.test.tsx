// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import WhatStep from "@/components/studio/WhatStep";
import AddDayFlow from "@/components/studio/day/AddDayFlow";
import NewTripFlow from "@/components/studio/trip/NewTripFlow";
import StudioBarProvider from "@/components/studio/StudioBar";
import StudioPage from "@/components/studio/StudioPage";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";

// B2077 — NewTripFlow keeps its step in the URL (`useStep`), which needs the
// app router; a first render only reads `?step=`, so an empty one will do.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/alex/studio/trip/new",
  useSearchParams: () => new URLSearchParams(),
}));

/**
 * B1900 — every studio intro screen announced its title twice: once as the
 * flow's own `<h1>`, and again immediately below as `WhatStep`'s `<h2>`
 * (or, for `NewTripFlow`'s own step 01, a second inline `<h2>` with the
 * identical text). Two headings for one screen either repeats the same
 * words or, worse for a screen reader, announces two "this is the title"
 * landmarks in a row for no reason.
 *
 * Since B2068 the page's one `<h1>` is `StudioPage`'s, so each flow is
 * rendered here the way its page renders it — inside `StudioPage`.
 */

vi.mock("@/components/PageHeader", () => ({ default: () => <header /> }));

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  // The flow saves a session draft (B2077); one test's typing must not
  // reappear in the next.
  sessionStorage.clear();
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

function render(node: React.ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<LocaleProvider dictionary={dictionaryFor("en")} locale="en">{node}</LocaleProvider>);
  });
}

describe("WhatStep — hideHeading", () => {
  test("renders its own <h2> by default", () => {
    render(<WhatStep title="A title" consequence="c" cta={{ label: "Go", onContinue: () => {} }} />);
    expect(container!.querySelectorAll("h1,h2").length).toBe(1);
  });

  test("hideHeading skips the <h2> a caller's own <h1> already said", () => {
    render(<WhatStep title="A title" hideHeading consequence="c" cta={{ label: "Go", onContinue: () => {} }} />);
    expect(container!.querySelectorAll("h1,h2").length).toBe(0);
    // The rest of the step still renders — this only drops the heading.
    expect(container!.textContent).toContain("c");
    expect(container!.textContent).toContain("Go");
  });
});

// B2110 — rule 5: under the studio's provider the intro's one primary is the
// bar's, never an inline button beside it.
describe("WhatStep — inStudioBar", () => {
  test("renders no inline CTA and exactly one bar primary", () => {
    let went = false;
    render(
      <StudioBarProvider username="alex">
        <StudioPage username="alex" group="write" title="T">
          <WhatStep inStudioBar title="T" hideHeading consequence="c" cta={{ label: "Start a day", onContinue: () => (went = true) }} />
        </StudioPage>
      </StudioBarProvider>,
    );
    const go = Array.from(container!.querySelectorAll("button")).filter((b) => b.textContent === "Start a day");
    expect(go).toHaveLength(1);
    // It sits in the bar (ActionBar's sticky root), not in the step's own markup.
    expect(go[0].closest(".sticky")).not.toBeNull();
    expect(go[0].className).toContain("bg-action-strong");
    act(() => go[0].click());
    expect(went).toBe(true);
  });
});

describe("AddDayFlow — day/new's opening screen announces its title once", () => {
  test("exactly one heading, not the title twice", () => {
    // The real page is always under the studio layout's bar provider; the
    // intro's primary registers there since B2110.
    render(
      <StudioBarProvider username="alex">
      <StudioPage username="alex" group="write" title="A day, in your own words">
      <AddDayFlow
        username="alex"
        trips={[{ id: "reise", title: "Reise", start: "2025-01-01", end: "2025-12-31" }]}
        writtenDatesByTrip={{ reise: [] }}
        proposal={null}
      />
      </StudioPage>
      </StudioBarProvider>,
    );
    const headings = Array.from(container!.querySelectorAll("h1,h2"));
    expect(headings.map((h) => h.textContent)).toEqual(["A day, in your own words"]);
  });
});

describe("NewTripFlow — trip/new's opening screen announces its title once", () => {
  test("exactly one heading, not 'A new trip' twice", () => {
    render(
      <StudioBarProvider username="alex">
        <StudioPage username="alex" group="plan" title="A new trip">
        <NewTripFlow
          username="alex"
          visibilities={["guest", "public", "private"]}
          accents={["sky"]}
          existingTrips={[]}
          whatsappAvailable={false}
          otherLocales={[]}
          defaultLocale="en"
          baseCurrency="CHF"
          currencies={["CHF"]}
          contacts={[]}
          figures={[]}
          journalFigures={[]}
        />
        </StudioPage>
      </StudioBarProvider>,
    );
    const headings = Array.from(container!.querySelectorAll("h1,h2"));
    expect(headings.map((h) => h.textContent)).toEqual(["A new trip"]);
  });
});
