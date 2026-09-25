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

/**
 * The words changed in B994. The old ones — *"Ask for anything else, in your
 * own words"* — are the sentence you write for a blank text box: they ask
 * somebody to compose, when what is on the other end is an agent that could
 * be told "this day, please".
 */
describe("the ask box, where the owner actually is", () => {
  test("an owner on a day page is offered it", async () => {
    const host = await dayPage(true);
    expect(host.textContent).toContain("See everything else you can do");
    expect(fetched.some((url) => url.includes("/api/helper/alex/ask"))).toBe(true);
  });

  /**
   * B979 — it leads somewhere whole rather than opening a lesser copy in
   * place. B984 made that somewhere `/agent`, with the day riding as an
   * `about` parameter so the conversation on the other end knew where it had
   * been pressed (B994).
   *
   * **B1905 repointed it at the studio**, and the day no longer rides along.
   * That is a real loss and it is deliberate: `/agent` was one conversation
   * that could be told which day you were on, and the studio is a list of
   * twelve flows, each of which asks for its own subject. The general row
   * means "everything else", and everything else is no longer day-scoped.
   *
   * The publish row below is the one that still carries the day, because it
   * still goes to the room — publishing has no studio flow.
   */
  test("it leads to the studio, which is where everything else now lives", async () => {
    const host = await dayPage(true);
    const link = [...host.querySelectorAll("a")].find((anchor) =>
      anchor.textContent?.includes("See everything else you can do"),
    ) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/alex/studio");
  });

  /**
   * B1007 — the draft row. The banner above a draft day has always *said* to
   * ask the agent to publish it, with nothing to press; this is the thing to
   * press, and it is drawn only while the day is not on the site.
   */
  test("a draft day offers the publish row, into the studio's publish page with this day chosen", async () => {
    const host = await dayPage(true, true);
    const link = [...host.querySelectorAll("a")].find((anchor) =>
      anchor.textContent?.includes("Share this day"),
    ) as HTMLAnchorElement;
    // B2169 — the studio page (B2140), not the retired room.
    expect(link.getAttribute("href")).toBe("/alex/studio/day/publish?day=bellinzona&trip=reise-2026");
    expect(host.innerHTML).not.toContain('href="/agent');
  });

  test("a day already on the site does not", async () => {
    const host = await dayPage(true);
    expect(host.textContent).not.toContain("Share this day");
  });

  test("a reader is offered nothing, and the journal is not even asked about", async () => {
    const host = await dayPage(false);
    expect(host.textContent).not.toContain("Talk to your agent about this day");
    // The correction link is the neighbouring owner-only control; if it were
    // showing, the gate under test would be the wrong one.
    expect(host.textContent).not.toContain("Correct or take down");
    expect(fetched.some((url) => url.includes("/api/helper/alex/ask"))).toBe(false);
  });
});
