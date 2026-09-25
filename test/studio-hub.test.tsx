// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import StudioHub from "@/components/studio/StudioHub";
import StudioBarProvider from "@/components/studio/StudioBar";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";
import type { StudioHubModel } from "@/lib/studio/hub";

/**
 * The hub's three non-default states — B1829, spec §3.
 *
 * H1 (the full hub, greyed cards and all) and its two live "cannot run"
 * reasons are driven in a real browser against `content/example/` (see the
 * ticket's own report). This file covers what a real browser session could
 * not, cheaply: **H2** (an empty journal has no trips to seed locally
 * without inventing one) and **H4**'s pluralisation (the demo journal has no
 * half-done import to resume). Both are pure rendering given a
 * `StudioHubModel` — `lib/studio/hub.ts`'s own reads are exercised
 * separately by whatever flow first writes a real run (B1830 will be the
 * first caller with something to assert against).
 */

// PageHeader needs the site's provider; its own tests cover it. Here only
// the way back it is handed matters (the hub has none — it is the studio).
vi.mock("@/components/PageHeader", () => ({
  default: ({ backTo }: { backTo?: { href: string } }) => <header data-back={backTo?.href} />,
}));

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

// `StudioHub` calls `useStudioBar` (B2001) — it now needs the provider
// `app/[user]/studio/layout.tsx` supplies in the real app, or the hook
// throws. Wrapping it here is the only change this needed: the provider
// renders its own `ActionBar` as a sibling right after `StudioHub`, in the
// same container, so every anchor-count assertion below still finds it.
function render(model: StudioHubModel) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
        <StudioBarProvider username="alex">
          <StudioHub username="alex" model={model} />
        </StudioBarProvider>
      </LocaleProvider>,
    );
  });
  return container;
}

const EMPTY_BASE: Extract<StudioHubModel, { kind: "empty" }> = {
  kind: "empty",
  account: { credits: null, purchasesOpen: 0, storage: null },
  print: { unfinished: [], recentOrders: [] },
  resumableImports: [],
  analyticsEnabled: false,
  postcardSuggestion: null, routeRecordingTrips: [],
};

describe("H2 — an empty journal", () => {
  test("shows one call to action, not a grid", () => {
    const el = render(EMPTY_BASE);
    // One button-shaped affordance ("Make your first trip"), not fourteen
    // group cards — spec §3: "One call to action, not a grid."
    expect(el.textContent).toContain("Nothing here yet");
    expect(el.textContent).toContain("Make your first trip");
    // None of the grouped flows render at all in this state.
    expect(el.textContent).not.toContain("Change a day");
    expect(el.textContent).not.toContain("A postcard");
  });

  test("offers photographs as a real second path, not a dead end", () => {
    const el = render(EMPTY_BASE);
    const link = el.querySelector('a[href="/alex/studio/photos"]');
    expect(link).not.toBeNull();
  });

  /** B2016 — credits and storage need no trip to mean anything, so the
   *  Journal group renders in the empty state too. B2066 moved the contacts
   *  link out of Journal into People's "Manage readers" row, which the empty
   *  state does not carry (hero + Bring in + Journal, exactly), and keeps
   *  Visitors in the list greyed with its reason rather than absent. */
  test("the whole Journal group renders, not only Credits & storage", () => {
    const el = render(EMPTY_BASE);
    expect(el.textContent).toContain("Journal");
    expect(el.textContent).toContain("Credits & storage");
    expect(el.textContent).toContain("Journal settings");
    expect(el.textContent).toContain("Permissions & keys");
    expect(el.textContent).toContain("Visitors");
    expect(el.textContent).toContain("Visits are not counted on this journal.");
    expect(el.querySelector('a[href="/alex/studio/account"]')).not.toBeNull();
    expect(el.querySelector('a[href="/alex/studio/journal"]')).not.toBeNull();
    expect(el.querySelector('a[href="/alex/studio/agent"]')).not.toBeNull();
  });

  /** B2017 — export and delete, quiet text below every group, in this state
   *  too: an owner of a journal with no trips yet might still want either. */
  test("export and delete render here too, as quiet text below the group", () => {
    const el = render(EMPTY_BASE);
    expect(el.textContent).toContain("Export everything");
    expect(el.textContent).toContain("Delete this journal");
  });

  test("a half-done import resumes above the CTA even before a first trip exists", () => {
    // A photographs import's own Step 02 offers "a new trip" from inside
    // the flow, so an empty journal with something to resume is real, not
    // an edge case — spec §3: resume lives on the hub, not only inside
    // each flow.
    const el = render({
      ...EMPTY_BASE,
      resumableImports: [
        { runId: "r1", createdAt: "2026-09-01T00:00:00.000Z", expiresAt: "2026-09-05T00:00:00.000Z", livePhotoCount: 12, daysLeftToTell: 2, stagedBytes: 5_000_000 },
      ],
    });
    // B2067: the Half done strip replaced the banner and its intro line.
    expect(el.querySelector("[data-half-done]")?.textContent).toContain("Half done");
    expect(el.textContent).toContain("12 photographs");
    expect(el.textContent).toContain("Nothing here yet");
  });
});

const FULL_BASE: Extract<StudioHubModel, { kind: "full" }> = {
  kind: "full",
  account: { credits: null, purchasesOpen: 0, storage: null },
  print: { unfinished: [], recentOrders: [] },
  addDayTrip: { id: "alps-2024", title: "Four days round the Alps", current: true },
  planTrip: null,
  cannotRun: { postcard: false, photobook: false, changeDay: false, reshapeDay: false },
  resumableImports: [],
  analyticsEnabled: false,
  postcardSuggestion: null, routeRecordingTrips: [],
  facts: { drafts: 0, inboxCount: 0, inboxBytes: 0, planStartsInDays: null, readersAsking: 0 },
};

describe("H1 — the cannot-run reasons are worded apart", () => {
  // The spec's third reason ("it is broken and we know") shipped once,
  // hardcoded to the location card for B1819's Android-Timeline bug — and
  // went false the hour B1819 merged and fixed it. Nothing in this codebase
  // tracks "this importer is known broken" as a real, readable fact, so
  // that reason has no field on `StudioHubModel["cannotRun"]` any more (see
  // its doc comment in `lib/studio/hub.ts`) and location renders as an
  // ordinary card, same as every other not-yet-built flow.
  test("location carries no reason — it is an ordinary card, not a known-bug one", () => {
    const el = render(FULL_BASE);
    expect(el.textContent).toContain("Your route");
    expect(el.textContent).not.toContain("our bug");
    expect(el.textContent).not.toMatch(/Android/i);
  });

  test("no days yet reads as 'nothing to act on', not as broken or off", () => {
    const el = render({ ...FULL_BASE, cannotRun: { ...FULL_BASE.cannotRun, changeDay: true, reshapeDay: true } });
    expect(el.textContent).toContain("No days yet — write one first.");
    expect(el.textContent).toContain("No days yet — nothing to refile.");
  });

  test("printing switched off reads calmly, with no apology", () => {
    const el = render({ ...FULL_BASE, cannotRun: { ...FULL_BASE.cannotRun, postcard: true, photobook: true } });
    expect(el.textContent).toContain("Printing is switched off on this instance.");
    expect(el.textContent).not.toMatch(/cannot send postcards\.[^A-Z]*(sorry|our bug|apolog)/i);
  });

  test("D5 — no contacts card under Bring in", () => {
    const el = render(FULL_BASE);
    expect(el.textContent).not.toContain("Contacts");
  });

  /**
   * D8 — B2016 gave the Journal group its Credits & storage card, moved
   * whole from the old `/account` nav tab; B2017 widens it with journal
   * settings, the agent card, visitors (gated on `analyticsEnabled`) and
   * people, plus a quiet export/delete pair below every group — the whole
   * owner block that used to sit on `/[user]/me`.
   */
  test("D8 — journal settings, the agent card and people all have a card; visitors follows analyticsEnabled", () => {
    const withoutAnalytics = render(FULL_BASE);
    expect(withoutAnalytics.textContent).toContain("Journal");
    expect(withoutAnalytics.textContent).toContain("Credits & storage");
    expect(withoutAnalytics.textContent).toContain("Journal settings");
    expect(withoutAnalytics.textContent).toContain("Permissions & keys");
    expect(withoutAnalytics.textContent).toContain("People");
    expect(withoutAnalytics.querySelector('a[href="/alex/studio/journal"]')).not.toBeNull();
    expect(withoutAnalytics.querySelector('a[href="/alex/studio/agent"]')).not.toBeNull();
    expect(withoutAnalytics.querySelector('a[href="/alex/studio/readers"]')).not.toBeNull();
    // B2066: greyed with its reason and an "off" chip, never absent.
    const visitorsOff = withoutAnalytics.querySelector('a[href="/alex/studio/visitors"]');
    expect(visitorsOff?.textContent).toContain("Visits are not counted on this journal.");
    expect(visitorsOff?.textContent).toContain("off");

    const withAnalytics = render({ ...FULL_BASE, analyticsEnabled: true });
    const visitorsOn = withAnalytics.querySelector('a[href="/alex/studio/visitors"]');
    expect(visitorsOn?.textContent).toBe("Visitors");
  });

  /** Export and delete — B1295/B1346, moved whole from `/[user]/me` by
   *  B2017 and made tiles by B2023: two buttons below every group, and
   *  nothing sends on the first press — each opens its own question. */
  test("export and delete sit below every group as tiles that open a question", () => {
    const el = render(FULL_BASE);
    const tiles = Array.from(el.querySelectorAll("button[aria-expanded]"));
    expect(tiles.map((b) => b.getAttribute("aria-expanded"))).toEqual(["false", "false"]);
    expect(el.textContent).toContain("Export everything");
    expect(el.textContent).toContain("Delete this journal");
    expect(el.textContent).not.toContain("Send me the link");
  });
});

describe("H4 — half-done work resumes from the hub, above the list", () => {
  test("a single run reads in the singular", () => {
    const el = render({
      ...FULL_BASE,
      resumableImports: [
        { runId: "r1", createdAt: "2026-09-01T00:00:00.000Z", expiresAt: "2026-09-05T00:00:00.000Z", livePhotoCount: 1, daysLeftToTell: 1, stagedBytes: 1_000_000 },
      ],
    });
    expect(el.querySelector("[data-half-done]")?.textContent).toContain("Half done");
    expect(el.textContent).toContain("1 photograph");
    expect(el.textContent).not.toContain("1 photographs");
  });

  test("several runs read in the plural and each still names its own size", () => {
    const el = render({
      ...FULL_BASE,
      resumableImports: [
        { runId: "r1", createdAt: "2026-09-01T00:00:00.000Z", expiresAt: "2026-09-05T00:00:00.000Z", livePhotoCount: 142, daysLeftToTell: 3, stagedBytes: 1_400_000_000 },
        { runId: "r2", createdAt: "2026-09-02T00:00:00.000Z", expiresAt: "2026-09-06T00:00:00.000Z", livePhotoCount: 4, daysLeftToTell: 1, stagedBytes: 12_000_000 },
      ],
    });
    expect(el.querySelectorAll("[data-half-done] a").length).toBe(2);
    expect(el.textContent).toContain("142 photographs");
    expect(el.textContent).toContain("4 photographs");
    // The link back is the real, existing flow — B1829 reuses it rather
    // than inventing a second resumable surface, and B1825 moved that flow's
    // own address from `/extract` to `/studio/photos` — the same address
    // the hub's own "Photographs" card already uses, so the two resume
    // banners share it with that card: three anchors. B1992 added a fourth,
    // in the phone-only sticky `ActionBar` at the foot of the page — the
    // same address again, for the same reason every one of these anchors
    // points here.
    expect(el.querySelectorAll('a[href="/alex/studio/photos"]').length).toBe(4);
  });
});

describe("B1951 — the main card never calls a finished trip the trip you are on", () => {
  test("a current trip: unchanged — the main card leads with 'Add a day', named as current", () => {
    const el = render(FULL_BASE);
    const mainCard = el.querySelector("a[data-hero]");
    expect(mainCard).not.toBeNull();
    expect(mainCard!.textContent).toContain("Add a day");
    expect(mainCard!.textContent).toContain("Four days round the Alps · the trip you are on");
    expect(mainCard!.getAttribute("href")).toBe("/alex/studio/day/new?from=hub");
  });

  test("no current trip, but a finished one: the main card offers a new trip, never calls the finished trip current", () => {
    const el = render({
      ...FULL_BASE,
      addDayTrip: { id: "alps-2023", title: "Three weeks in Japan", current: false },
    });
    // The main card is now the new-trip flow.
    const mainCard = el.querySelector("a[data-hero]");
    expect(mainCard).not.toBeNull();
    expect(mainCard!.getAttribute("href")).toBe("/alex/studio/trip/new");
    expect(mainCard!.textContent).toContain("A new trip");
    // Nothing on the page claims the finished trip is the one the person is on.
    expect(el.textContent).not.toContain("the trip you are on");
    // Adding a day to the finished trip is still reachable, honestly labelled.
    // B2134: it carries the ended trip, so day/new opens with it chosen.
    const addDayEnded = el.querySelector('a[href="/alex/studio/day/new?trip=alps-2023&from=hub"]');
    expect(addDayEnded).not.toBeNull();
    expect(addDayEnded!.textContent).toContain("Add a day to Three weeks in Japan");
    expect(addDayEnded!.textContent).toContain("Three weeks in Japan has ended");
  });

  test("no trips at all: the empty journal's single call to action is unchanged", () => {
    const el = render(EMPTY_BASE);
    expect(el.textContent).toContain("Nothing here yet");
    expect(el.textContent).toContain("Make your first trip");
    expect(el.textContent).not.toContain("the trip you are on");
    expect(el.textContent).not.toContain("A new trip");
  });

  test("no current and no past trip (every trip still upcoming): unchanged generic main card, no trip named", () => {
    const el = render({ ...FULL_BASE, addDayTrip: null });
    expect(el.textContent).toContain("Add a day");
    expect(el.textContent).toContain("Photographs, a few words, and it waits as a draft.");
    expect(el.textContent).not.toContain("the trip you are on");
    expect(el.textContent).not.toContain("Add a day to");
  });
});

/** B2066 — the Desk: six group cards, one icon per row, one line per row. */
describe("B2066 — the Desk", () => {
  const groupsOf = (el: HTMLElement) => Array.from(el.querySelectorAll("section[data-group]")).map((s) => s.id);
  const iconOf = (row: Element) =>
    Array.from(row.querySelector("svg")?.classList ?? []).find((c) => c.startsWith("lucide-") && c !== "lucide-icon");

  const heroStates: [string, StudioHubModel][] = [
    ["current trip", FULL_BASE],
    ["ended trip", { ...FULL_BASE, addDayTrip: { id: "jp", title: "Japan", current: false } }],
    ["no current or past trip", { ...FULL_BASE, addDayTrip: null }],
    ["empty journal", EMPTY_BASE],
  ];

  test("the six groups render as cards in their fixed order, each with its own anchor", () => {
    const el = render({ ...FULL_BASE, planTrip: { id: "jp", title: "Japan" }, analyticsEnabled: true });
    expect(groupsOf(el)).toEqual(["write", "plan", "people", "bringIn", "print", "journal"]);
    expect(el.querySelector("#plan")).not.toBeNull();
  });

  test.each(heroStates)("no lucide icon is used on two rows (%s)", (_, model) => {
    const el = render(model);
    const icons = Array.from(el.querySelectorAll("a[data-row]")).map(iconOf);
    expect(icons.every(Boolean)).toBe(true);
    expect(new Set(icons).size).toBe(icons.length);
  });

  test("every row outside Journal has a description", () => {
    const el = render({ ...FULL_BASE, planTrip: { id: "jp", title: "Japan" } });
    const rows = Array.from(el.querySelectorAll("section[data-group]:not(#journal) a[data-row]"));
    expect(rows.length).toBeGreaterThan(10);
    for (const row of rows) expect(row.querySelector("[data-desc]")?.textContent?.trim(), row.textContent ?? "").toBeTruthy();
  });

  test.each(heroStates.slice(0, 3))("'A new trip' appears exactly once (%s)", (_, model) => {
    const el = render(model);
    expect(el.textContent!.split("A new trip").length - 1).toBe(1);
  });

  test("the empty state is exactly the hero, Bring in (photographs, your route) and Journal", () => {
    const el = render(EMPTY_BASE);
    expect(el.querySelectorAll("a[data-hero]").length).toBe(1);
    expect(groupsOf(el)).toEqual(["bringIn", "journal"]);
    expect(Array.from(el.querySelectorAll("#bringIn a[data-row]")).map((a) => a.getAttribute("href"))).toEqual([
      "/alex/studio/photos",
      "/alex/studio/location?from=hub",
    ]);
  });

  test("printing off keeps both print rows, greyed, with an off chip", () => {
    const el = render({ ...FULL_BASE, cannotRun: { ...FULL_BASE.cannotRun, postcard: true, photobook: true } });
    const rows = Array.from(el.querySelectorAll("#print a[data-row]"));
    expect(rows.length).toBe(2);
    for (const row of rows) {
      expect(row.querySelector("[data-desc]")?.textContent).toContain("Printing is switched off on this instance.");
      expect(row.textContent).toContain("off");
    }
  });

  test("the hub has no group mark and no back link to itself", () => {
    const el = render(FULL_BASE);
    expect(el.querySelector("h1")?.textContent).toBe("What would you like to do?");
    expect(el.querySelector("header[data-back]")).toBeNull();
  });
});

/** B2110 — the Readers row says what the invite does: access opens at
 *  once (D11), never "they get asked first". B2133 made it the one row for
 *  the one readers page, with the asking chip and no "Manage readers". */
describe("B2110 — the Readers row tells the truth", () => {
  test("its line says access opens at once, and it is the People card's only readers row", () => {
    const el = render(FULL_BASE);
    const rows = Array.from(el.querySelectorAll("a[data-row]")).filter((a) => /\/studio\/reader/.test(a.getAttribute("href") ?? ""));
    expect(rows.map((a) => a.getAttribute("href"))).toEqual(["/alex/studio/readers"]);
    expect(rows[0].textContent).toContain("Readers");
    expect(rows[0].textContent).toContain("Let somebody in at once, and answer who asks.");
    expect(el.textContent).not.toContain("asked first");
    expect(el.textContent).not.toContain("Manage readers");
  });
});

/** B2193 — "Waiting for your words": one card per day with waiting
 *  photographs, the no-date ones apart, and the section absent when nothing
 *  waits. */
describe("B2193 — waiting photographs as day cards", () => {
  const card = (date: string, n: number, extra: Partial<{ place: string; trip: { id: string; title: string }; newTrip: { start: string; end: string } }> = {}) => ({
    date,
    photoIds: Array.from({ length: n }, (_, i) => `${date}-${i}.jpg`),
    place: extra.place ?? null,
    trip: extra.trip ?? null,
    newTrip: extra.newTrip ?? null,
  });

  test("three dates are three cards; each opens the composer with that day's photographs", () => {
    const el = render({
      ...FULL_BASE,
      waitingDays: {
        cards: [
          card("2026-09-22", 31, { place: "Porto", trip: { id: "pt", title: "Portugal" } }),
          card("2026-09-23", 12, { trip: { id: "pt", title: "Portugal" } }),
          card("2026-09-28", 1, { newTrip: { start: "2026-09-28", end: "2026-09-30" } }),
        ],
        undatedIds: ["wa-1.jpg", "wa-2.jpg"],
      },
    });
    const section = el.querySelector("[data-waiting-days]")!;
    expect(section.querySelector("h2")?.textContent).toBe("Waiting for your words");
    const cards = Array.from(section.querySelectorAll("[data-day-card]"));
    expect(cards.map((c) => c.getAttribute("data-day-card"))).toEqual(["2026-09-22", "2026-09-23", "2026-09-28", "undated"]);
    expect(cards[0].textContent).toContain("Porto · 31 photos");
    expect(cards[0].querySelector("a")?.getAttribute("href")).toBe("/alex/studio/day/new?photos=2026-09-22&from=hub");
    expect(cards[2].textContent).toContain("No trip covers this day yet.");
    expect(Array.from(cards[2].querySelectorAll("a"), (a) => a.getAttribute("href"))).toEqual([
      "/alex/studio/trip/new?start=2026-09-28&end=2026-09-30",
      "/alex/studio/day/new?photos=2026-09-28&from=hub",
    ]);
    expect(cards[3].textContent).toContain("2 photos have no date");
    expect(cards[3].querySelector("a")?.getAttribute("href")).toBe("/alex/studio/day/new?photos=undated&from=hub");
  });

  test("five cards, then the rest behind one button", () => {
    const el = render({
      ...FULL_BASE,
      waitingDays: { cards: ["01", "02", "03", "04", "05", "06", "07"].map((d) => card(`2026-09-${d}`, 1)), undatedIds: [] },
    });
    expect(el.querySelectorAll("[data-day-card]")).toHaveLength(5);
    const more = Array.from(el.querySelectorAll("button")).find((b) => b.textContent === "Show 2 more days")!;
    act(() => more.click());
    expect(el.querySelectorAll("[data-day-card]")).toHaveLength(7);
  });

  test("a run of uncovered days proposes its trip once, on its first card", () => {
    const run = { start: "2026-04-10", end: "2026-04-13" };
    const el = render({
      ...FULL_BASE,
      waitingDays: { cards: ["10", "11", "13"].map((d) => card(`2026-04-${d}`, 1, { newTrip: run })), undatedIds: [] },
    });
    expect(Array.from(el.querySelectorAll('[data-day-card] a[href*="trip/new"]'), (a) => a.textContent)).toEqual(["Start a trip for 10 Apr – 13 Apr"]);
  });

  test("nothing waiting: no section at all, not an empty panel", () => {
    expect(render({ ...FULL_BASE, waitingDays: { cards: [], undatedIds: [] } }).querySelector("[data-waiting-days]")).toBeNull();
  });

  test("before the first trip, a card proposes one and offers no day to write", () => {
    const el = render({
      ...EMPTY_BASE,
      waitingDays: { cards: [card("2026-09-22", 3, { newTrip: { start: "2026-09-22", end: "2026-09-22" } })], undatedIds: ["wa.jpg"] },
    });
    const cards = Array.from(el.querySelectorAll("[data-day-card]"));
    expect(cards).toHaveLength(1);
    expect(Array.from(cards[0].querySelectorAll("a"), (a) => a.textContent)).toEqual(["Start a trip for 22 Sep"]);
  });
});
