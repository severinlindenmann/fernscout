// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import CurrencyProvider from "@/components/CurrencyProvider";
import LocaleProvider from "@/components/LocaleProvider";
import { DayCard } from "@/components/StoryPager";
import TripProvider from "@/components/TripProvider";
import { dictionaryFor } from "@/lib/locales";
import type { Day, DaySummary, Trip } from "@/lib/types";

/**
 * B844 — the ask box was on a page the person it was built for never opened.
 *
 * A returning owner did all six of her tasks from the day, the trip and the
 * story, and reported that there was no request box. She was right: B685's
 * router, B817's refusals and B783's read row all landed on `/agent`, three
 * clicks from every page she used, while the box on the page she *was* on was
 * Search — which answers a different question and answered "fix a typo in
 * tuesday" with six day cards.
 *
 * So the two things worth asserting are the two that could silently regress:
 * an owner gets the box on the day page, and a reader never does. The second
 * matters more than the first — the box writes, and it sits inside the same
 * `canPublish` branch as the "Correct or take down this day" link for exactly
 * that reason.
 */

const TRIP = {
  id: "reise-2026",
  ref: "alex/reise-2026",
  username: "alex",
  title: "Reise",
} as unknown as Trip;

const SUMMARY: DaySummary = {
  date: "2026-08-01",
  slug: "bellinzona",
  location: "Bellinzona",
  country: "Switzerland",
} as unknown as DaySummary;

const ENTRY = {
  slug: "bellinzona",
  title: "Ankunft",
  date: "2026-08-01",
  location: "Bellinzona",
  country: "Switzerland",
  content: "<p>Words.</p>",
  gallery: [],
  costs: [],
};

const DAY = {
  date: "2026-08-01",
  lead: ENTRY,
  entries: [ENTRY],
} as unknown as Day;

let root: Root | undefined;
let container: HTMLDivElement | undefined;
const fetched: string[] = [];

beforeEach(() => {
  fetched.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      fetched.push(String(url));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          consented: true,
          speech: false,
          consentedSpeech: false,
          speechProvider: "dry-run",
        }),
      } as unknown as Response;
    }),
  );
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  vi.unstubAllGlobals();
});

/** Mount the real day card, and let the one fetch its ask box makes settle. */
async function dayPage(canPublish: boolean) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
        <CurrencyProvider options={{ base: "CHF", currencies: ["CHF"], rates: { CHF: 1 } }}>
          <TripProvider trip={TRIP} isCurrent canPublish={canPublish} reader="person">
            <DayCard day={DAY} summary={SUMMARY} dayIndex={0} />
          </TripProvider>
        </CurrencyProvider>
      </LocaleProvider>,
    );
  });
  // The config fetch resolves on a microtask; the state it sets needs one more.
  await act(async () => {});
  return container;
}

describe("the ask box, where the owner actually is", () => {
  test("an owner on a day page is offered it", async () => {
    const host = await dayPage(true);
    expect(host.textContent).toContain("Or ask for a change to this journal");
    expect(fetched.some((url) => url.includes("/api/helper/alex/ask"))).toBe(true);
  });

  test("it is not Search, and says so in a word each", async () => {
    const host = await dayPage(true);
    const opener = [...host.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Or ask for a change"),
    ) as HTMLButtonElement;
    act(() => opener.click());
    expect(host.textContent).toContain("Search finds. Asking changes.");
  });

  test("a reader is offered nothing, and the journal is not even asked about", async () => {
    const host = await dayPage(false);
    expect(host.textContent).not.toContain("Or ask for a change to this journal");
    // The correction link is the neighbouring owner-only control; if it were
    // showing, the gate under test would be the wrong one.
    expect(host.textContent).not.toContain("Correct or take down this day");
    expect(fetched.some((url) => url.includes("/api/helper/alex/ask"))).toBe(false);
  });
});
