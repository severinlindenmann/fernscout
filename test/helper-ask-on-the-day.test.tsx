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
 * B844 put an ask box on the day page; B1007 through B1905 kept moving where
 * it pointed. **B2309 removed it outright**, on the owner's own word: a grid
 * that ends in "ask your agent" is a grid that does not trust its own tiles,
 * and nothing on the page called the `GET …/ask` probe that gated it once
 * the row it gated was gone. This file now asserts the opposite of what it
 * used to: no row, no probe, on the day page or the draft banner above it —
 * plus what actually replaced the correction door B980 sat next to: Edit is
 * offered on a draft the same as on a published day.
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

/** The same day before it is on the site — `allDraft` in `StoryPager`. */
const DRAFT_DAY = {
  date: "2026-08-01",
  lead: { ...ENTRY, draft: true },
  entries: [{ ...ENTRY, draft: true }],
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
async function dayPage(canPublish: boolean, draft = false) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
        <CurrencyProvider options={{ base: "CHF", currencies: ["CHF"], rates: { CHF: 1 } }}>
          <TripProvider trip={TRIP} isCurrent canPublish={canPublish} reader="person">
            <DayCard
              day={draft ? DRAFT_DAY : DAY}
              summary={SUMMARY}
              dayIndex={0}
            />
          </TripProvider>
        </CurrencyProvider>
      </LocaleProvider>,
    );
  });
  // The config fetch resolves on a microtask; the state it sets needs one more.
  await act(async () => {});
  return container;
}

describe("the day page, since the ask row went — B2309", () => {
  test("an owner gets no row into the studio hub, and nothing asks the helper for one", async () => {
    const host = await dayPage(true);
    expect(host.textContent).not.toContain("See everything else you can do");
    expect(fetched.some((url) => url.includes("/api/helper/alex/ask"))).toBe(false);
  });

  test("a draft day still offers the publish row, into the studio's publish page with this day chosen", async () => {
    const host = await dayPage(true, true);
    const link = [...host.querySelectorAll("a")].find((anchor) =>
      anchor.textContent?.includes("Share this day"),
    ) as HTMLAnchorElement;
    // B2169 — the studio page (B2140), not the retired room.
    expect(link.getAttribute("href")).toBe("/alex/studio/day/publish?day=bellinzona&trip=reise-2026");
    expect(host.innerHTML).not.toContain('href="/agent');
  });

  test("a day already on the site does not offer the publish row", async () => {
    const host = await dayPage(true);
    expect(host.textContent).not.toContain("Share this day");
  });

  /** B2309 — Edit used to be published-only ("Correct or take down"); it is
   *  now offered, and in place, on a draft as well. */
  test("Edit is offered on a draft day too, and says just that", async () => {
    const host = await dayPage(true, true);
    expect(host.textContent).toContain("Edit");
    expect(host.textContent).not.toContain("Correct or take down");
  });

  test("a reader is offered nothing, and the journal is not even asked about", async () => {
    const host = await dayPage(false);
    expect(host.textContent).not.toContain("See everything else you can do");
    // The correction tile is the neighbouring owner-only control; if it were
    // showing, the gate under test would be the wrong one.
    expect(host.textContent).not.toContain("Edit");
    expect(fetched.some((url) => url.includes("/api/helper/alex/ask"))).toBe(false);
  });
});
