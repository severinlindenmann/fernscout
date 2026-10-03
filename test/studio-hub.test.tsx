// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import StudioHub from "@/components/studio/StudioHub";
import StudioBarProvider from "@/components/studio/StudioBar";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";
import { translate, plural } from "@/lib/i18n";
import { buildHubGroups, filterHubGroups } from "@/lib/studio/hubGroups";
import { typeInto } from "./support/type-input";
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
// `app/at/[user]/studio/layout.tsx` supplies in the real app, or the hook
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
  extractOff: false,
  account: { storage: null },
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
    const link = el.querySelector('a[href="/@alex/studio/photos"]');
    expect(link).not.toBeNull();
  });

  /** B2016 — credits and storage need no trip to mean anything, so the
   *  Journal group renders in the empty state too. B2066 moved the contacts
   *  link out of Journal into People's "Manage readers" row, which the empty
   *  state does not carry (hero + Bring in + Journal, exactly), and keeps
   *  Visitors in the list greyed with its reason rather than absent. */
  test("the whole Journal group renders, not only Plan & storage", () => {
    const el = render(EMPTY_BASE);
    expect(el.textContent).toContain("Journal");
    expect(el.textContent).toContain("Plan & storage");
    expect(el.textContent).toContain("Journal settings");
    expect(el.textContent).toContain("Permissions & keys");
    expect(el.textContent).toContain("Visitors");
    expect(el.textContent).toContain("Visits are not counted on this journal.");
    expect(el.querySelector('a[href="/@alex/studio/account"]')).not.toBeNull();
    expect(el.querySelector('a[href="/@alex/studio/journal"]')).not.toBeNull();
    expect(el.querySelector('a[href="/@alex/studio/agent"]')).not.toBeNull();
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
  account: { storage: null },
  print: { unfinished: [], recentOrders: [] },
  addDayTrip: { id: "alps-2024", title: "Four days round the Alps", current: true },
  toldToday: false,
  planTrip: null,
  cannotRun: { postcard: false, photobook: false, extract: false, readers: false, changeDay: false, reshapeDay: false },
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
    expect(el.textContent).toContain("GPX files & routes");
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
    expect(el.textContent).toContain("Printing is switched off.");
    expect(el.textContent).not.toMatch(/cannot send postcards\.[^A-Z]*(sorry|our bug|apolog)/i);
  });

  test("B2577 — Bring in an old trip and Readers grey with their page banner when off", () => {
    const off = render({ ...FULL_BASE, cannotRun: { ...FULL_BASE.cannotRun, extract: true, readers: true } });
    const photos = off.querySelector('a[data-row][href$="/studio/photos"]')!;
    expect(photos.querySelector("[data-desc]")?.textContent).toBe("This journal cannot bring in trips from photographs. Importing is switched off.");
    expect(photos.textContent).toContain("off");
    const readers = off.querySelector('a[data-row][href$="/studio/readers"]')!;
    expect(readers.querySelector("[data-desc]")?.textContent).toBe("This journal keeps no list of readers. Readers are switched off.");
    expect(readers.textContent).toContain("off");
  });

  test("B2577 — both rows stay plain when their capability is on", () => {
    const on = render(FULL_BASE);
    expect(on.querySelector('a[data-row][href$="/studio/photos"]')!.textContent).not.toContain("switched off");
    expect(on.querySelector('a[data-row][href$="/studio/readers"]')!.textContent).not.toContain("switched off");
  });

  test("B2577 — the empty-journal hub greys Bring in an old trip too", () => {
    const el = render({ ...EMPTY_BASE, extractOff: true });
    expect(el.querySelector('a[data-row][href$="/studio/photos"]')?.textContent).toContain("Importing is switched off.");
  });

  test("B2577 — the empty-journal hub keeps it plain when importing is on", () => {
    expect(render(EMPTY_BASE).querySelector('a[data-row][href$="/studio/photos"]')?.textContent).not.toContain("switched off");
  });

  test("D5 — no contacts card under Bring in", () => {
    const el = render(FULL_BASE);
    expect(el.textContent).not.toContain("Contacts");
  });

  /**
   * D8 — B2016 gave the Journal group its Plan & storage card, moved
   * whole from the old `/account` nav tab; B2017 widens it with journal
   * settings, the agent card, visitors (gated on `analyticsEnabled`) and
   * people, plus a quiet export/delete pair below every group — the whole
   * owner block that used to sit on `/[user]/me`.
   */
  test("D8 — journal settings, the agent card and people all have a card; visitors follows analyticsEnabled", () => {
    const withoutAnalytics = render(FULL_BASE);
    expect(withoutAnalytics.textContent).toContain("Journal");
    expect(withoutAnalytics.textContent).toContain("Plan & storage");
    expect(withoutAnalytics.textContent).toContain("Journal settings");
    expect(withoutAnalytics.textContent).toContain("Permissions & keys");
    expect(withoutAnalytics.textContent).toContain("Who was there");
    expect(withoutAnalytics.querySelector('a[href="/@alex/studio/journal"]')).not.toBeNull();
    expect(withoutAnalytics.querySelector('a[href="/@alex/studio/agent"]')).not.toBeNull();
    expect(withoutAnalytics.querySelector('a[href="/@alex/studio/readers"]')).not.toBeNull();
    // B2066: greyed with its reason and an "off" chip, never absent.
    const visitorsOff = withoutAnalytics.querySelector('a[href="/@alex/studio/visitors"]');
    expect(visitorsOff?.textContent).toContain("Visits are not counted on this journal.");
    expect(visitorsOff?.textContent).toContain("off");

    // B2600 — a second `render()` in the same test must unmount the first;
    // otherwise its container leaks into `document.body` for the rest of
    // the file's run, giving later tests a duplicate id (every group card
    // carries a fixed one) that jsdom's ID-selector fast path resolves
    // against the wrong, orphaned element.
    act(() => root?.unmount());
    container?.remove();
    const withAnalytics = render({ ...FULL_BASE, analyticsEnabled: true });
    const visitorsOn = withAnalytics.querySelector('a[href="/@alex/studio/visitors"]');
    expect(visitorsOn?.textContent).toBe("Visitors");
  });

  /** Export and delete — B1295/B1346, moved whole from `/[user]/me` by
   *  B2017 and made tiles by B2023: two buttons below every group, and
   *  nothing sends on the first press — each opens its own question. */
  // B2600 — Export and Delete moved inside Journal & account, alongside the
  // four disclosure toggles; every `aria-expanded` button on the page starts
  // closed, and pressing either tile opens its own question, not the mail.
  test("export and delete sit inside Journal & account as tiles that open a question", () => {
    const el = render(FULL_BASE);
    const tiles = Array.from(el.querySelectorAll("button[aria-expanded]"));
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.every((b) => b.getAttribute("aria-expanded") === "false")).toBe(true);
    expect(el.textContent).toContain("Export everything");
    expect(el.textContent).toContain("Delete this journal");
    expect(el.textContent).not.toContain("Send me the link");
    const exportTile = Array.from(el.querySelectorAll<HTMLButtonElement>("#journal button")).find((b) => b.textContent?.includes("Export everything"))!;
    act(() => exportTile.click());
    expect(exportTile.getAttribute("aria-expanded")).toBe("true");
    expect(el.textContent).toContain("Email me the download link");
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

  // B2304 — the strip is one slim line now, not a full list: only the first
  // item shows, the rest sit behind "+N more" until tapped.
  test("only the first item shows by default; the rest expand behind '+N more'", () => {
    const el = render({
      ...FULL_BASE,
      resumableImports: [
        { runId: "r1", createdAt: "2026-09-01T00:00:00.000Z", expiresAt: "2026-11-01T00:00:00.000Z", livePhotoCount: 142, daysLeftToTell: 3, stagedBytes: 1_400_000_000 },
        { runId: "r2", createdAt: "2026-09-02T00:00:00.000Z", expiresAt: "2026-11-02T00:00:00.000Z", livePhotoCount: 4, daysLeftToTell: 1, stagedBytes: 12_000_000 },
      ],
    });
    expect(el.querySelectorAll("[data-half-done] a").length).toBe(1);
    expect(el.textContent).toContain("142 photographs");
    expect(el.textContent).not.toContain("4 photographs");
    const more = Array.from(el.querySelectorAll<HTMLButtonElement>("[data-half-done] button")).find((b) => b.textContent === "+1 more")!;
    expect(more).toBeTruthy();
    act(() => more.click());
    expect(el.querySelectorAll("[data-half-done] a").length).toBe(2);
    expect(el.textContent).toContain("4 photographs");
  });

  // An import with a real deadline is never buried behind "+N more".
  test("an import expiring within 3 days is promoted to the shown line", () => {
    const soon = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const el = render({
      ...FULL_BASE,
      resumableImports: [
        { runId: "r1", createdAt: "2026-09-01T00:00:00.000Z", expiresAt: "2026-12-24T00:00:00.000Z", livePhotoCount: 9, daysLeftToTell: 3, stagedBytes: 900_000 },
        { runId: "r2", createdAt: "2026-09-02T00:00:00.000Z", expiresAt: soon, livePhotoCount: 4, daysLeftToTell: 1, stagedBytes: 12_000_000 },
      ],
    });
    expect(el.textContent).toContain("4 photographs");
    expect(el.textContent).not.toContain("9 photographs");
  });

  test("the resume link is the real, existing flow, shared with the Photographs row", () => {
    const el = render({
      ...FULL_BASE,
      resumableImports: [
        { runId: "r1", createdAt: "2026-09-01T00:00:00.000Z", expiresAt: "2026-11-01T00:00:00.000Z", livePhotoCount: 142, daysLeftToTell: 3, stagedBytes: 1_400_000_000 },
      ],
    });
    // B1829 reuses the same address B1825 moved from `/extract` to
    // `/studio/photos` rather than inventing a second resumable surface —
    // the half-done row and the Bring in group's own "Bring in an old trip"
    // row: two anchors. B2304 removed the phone bar's own third.
    expect(el.querySelectorAll('a[href="/@alex/studio/photos"]').length).toBe(2);
  });
});

describe("B1951 — the main card never calls a finished trip the trip you are on", () => {
  test("a current trip: unchanged — the main card leads with 'Add a day', named as current", () => {
    const el = render(FULL_BASE);
    const mainCard = el.querySelector("a[data-hero]");
    expect(mainCard).not.toBeNull();
    expect(mainCard!.textContent).toContain("Add a day");
    expect(mainCard!.textContent).toContain("Four days round the Alps · the trip you are on");
    expect(mainCard!.getAttribute("href")).toBe("/@alex/studio/day/new");
  });

  test("no current trip, but a finished one: the main card offers a new trip, never calls the finished trip current", () => {
    const el = render({
      ...FULL_BASE,
      addDayTrip: { id: "alps-2023", title: "Three weeks in Japan", current: false },
    });
    // The main card is now the between-trips hero (B2304: "Start a trip").
    const mainCard = el.querySelector("a[data-hero]");
    expect(mainCard).not.toBeNull();
    expect(mainCard!.getAttribute("href")).toBe("/@alex/studio/trip/new");
    expect(mainCard!.textContent).toContain("Start a trip");
    // Nothing on the page claims the finished trip is the one the person is on.
    expect(el.textContent).not.toContain("the trip you are on");
    // Adding a day to the finished trip is still reachable, honestly labelled.
    // B2134: it carries the ended trip, so day/new opens with it chosen.
    const addDayEnded = el.querySelector('a[href="/@alex/studio/day/new?trip=alps-2023"]');
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

  // B2304 — this is the owner's own Ungarn 2026 state (no current trip, one
  // still upcoming): "Start a trip", not a trip-less "Add a day" any more.
  test("no current and no past trip (every trip still upcoming): the between-trips hero, no trip named", () => {
    const el = render({ ...FULL_BASE, addDayTrip: null });
    const mainCard = el.querySelector("a[data-hero]")!;
    expect(mainCard.textContent).toContain("Start a trip");
    expect(mainCard.getAttribute("href")).toBe("/@alex/studio/trip/new");
    expect(el.textContent).not.toContain("the trip you are on");
    expect(el.textContent).not.toContain("Add a day to");
  });
});

/** B2600 — the Desk: Today's own card, then "Everything else"'s four cards,
 *  one icon per row, one line per row. */
describe("B2600 — the Desk", () => {
  const groupsOf = (el: HTMLElement) => Array.from(el.querySelectorAll("section[data-group]")).map((s) => s.id);
  const iconOf = (row: Element) =>
    Array.from(row.querySelector("svg")?.classList ?? []).find((c) => c.startsWith("lucide-") && c !== "lucide-icon");

  const heroStates: [string, StudioHubModel][] = [
    ["current trip", FULL_BASE],
    ["ended trip", { ...FULL_BASE, addDayTrip: { id: "jp", title: "Japan", current: false } }],
    ["no current or past trip", { ...FULL_BASE, addDayTrip: null }],
    ["empty journal", EMPTY_BASE],
  ];

  test("Today's own card, then the four 'Everything else' cards, in their fixed order, each with its own anchor", () => {
    const el = render({ ...FULL_BASE, planTrip: { id: "jp", title: "Japan" }, analyticsEnabled: true });
    expect(groupsOf(el)).toEqual(["write", "tripsPeople", "bringIn", "print", "journal"]);
    // Trips & people is one card, but the two subpages it merged (Plan and
    // People) still each get their own back-link anchor inside it.
    expect(el.querySelector("#plan")).not.toBeNull();
    expect(el.querySelector("#people")).not.toBeNull();
    expect(el.querySelector("#tripsPeople #plan")).not.toBeNull();
    expect(el.querySelector("#tripsPeople #people")).not.toBeNull();
  });

  test("heading navigation reaches Today and Everything else, in that order", () => {
    const el = render(FULL_BASE);
    const headings = Array.from(el.querySelectorAll("h2")).map((h) => h.id);
    expect(headings).toContain("h-today");
    expect(headings).toContain("h-everything");
    expect(headings.indexOf("h-today")).toBeLessThan(headings.indexOf("h-everything"));
  });

  test("the four 'Everything else' cards toggle open with a real button", () => {
    const el = render(FULL_BASE);
    const toggles = ["tripsPeople", "bringIn", "print", "journal"].map(
      (group) => el.querySelector<HTMLButtonElement>(`#${group} > button[aria-expanded]`)!,
    );
    for (const toggle of toggles) {
      expect(toggle).not.toBeNull();
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
    }
    act(() => toggles[0].click());
    expect(toggles[0].getAttribute("aria-expanded")).toBe("true");
  });

  test("Walking figures is not a hub row any more", () => {
    const el = render(FULL_BASE);
    expect(el.textContent).not.toContain("Walking figures");
    expect(el.querySelector('a[href="/@alex/studio/figures"]')).toBeNull();
  });

  test("no href appears twice across Today, the groups and Journal & account", () => {
    const el = render({ ...FULL_BASE, planTrip: { id: "jp", title: "Japan" }, analyticsEnabled: true });
    const hrefs = Array.from(el.querySelectorAll("section[data-group] a[href]")).map((a) => a.getAttribute("href"));
    expect(hrefs.length).toBeGreaterThan(10);
    expect(new Set(hrefs).size).toBe(hrefs.length);
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

  // B2304 — the hero no longer ever says "A new trip" itself (the ended-trip
  // and no-current-trip states both say "Start a trip" now), so the Plan
  // group's own row is the only place left carrying that exact text — and
  // it stays suppressed for an ended trip (unchanged grid: "not twice") even
  // though the hero's wording differs, so that state now reads zero times.
  const newTripCounts: [string, StudioHubModel, number][] = [
    ["current trip", FULL_BASE, 1],
    ["ended trip", { ...FULL_BASE, addDayTrip: { id: "jp", title: "Japan", current: false } }, 0],
    ["no current or past trip", { ...FULL_BASE, addDayTrip: null }, 1],
  ];
  test.each(newTripCounts)("'A new trip' appears the right number of times (%s)", (_, model, count) => {
    const el = render(model);
    expect(el.textContent!.split("A new trip").length - 1).toBe(count);
  });

  test("the empty state is exactly the hero, Bring in (photographs, your route) and Journal", () => {
    const el = render(EMPTY_BASE);
    expect(el.querySelectorAll("a[data-hero]").length).toBe(1);
    expect(groupsOf(el)).toEqual(["bringIn", "journal"]);
    expect(Array.from(el.querySelectorAll("#bringIn a[data-row]")).map((a) => a.getAttribute("href"))).toEqual([
      "/@alex/studio/photos",
      "/@alex/studio/location?from=hub",
    ]);
  });

  test("printing off keeps both print rows, greyed, with an off chip", () => {
    const el = render({ ...FULL_BASE, cannotRun: { ...FULL_BASE.cannotRun, postcard: true, photobook: true } });
    const rows = Array.from(el.querySelectorAll("#print a[data-row]"));
    expect(rows.length).toBe(2);
    for (const row of rows) {
      expect(row.querySelector("[data-desc]")?.textContent).toContain("Printing is switched off.");
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
    expect(rows.map((a) => a.getAttribute("href"))).toEqual(["/@alex/studio/readers"]);
    expect(rows[0].textContent).toContain("Readers");
    expect(rows[0].textContent).toContain("Let somebody in at once, and answer who asks.");
    expect(el.textContent).not.toContain("asked first");
    expect(el.textContent).not.toContain("Manage readers");
  });
});

/** B2193 — "Waiting for your words": one card per day with waiting
 *  photographs, the no-date ones apart, and the section absent when nothing
 *  waits. */
// B2304 — during a trip the full card list is replaced by one condensed row
// (see "the during-trip rows" below), so this describe block now reads
// against a between-trips model, the state that still renders it.
const NOT_DURING_TRIP: Extract<StudioHubModel, { kind: "full" }> = { ...FULL_BASE, addDayTrip: null };

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
      ...NOT_DURING_TRIP,
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
    expect(cards[0].querySelector("a")?.getAttribute("href")).toBe("/@alex/studio/day/new?photos=2026-09-22");
    expect(cards[2].textContent).toContain("No trip covers this day yet.");
    expect(Array.from(cards[2].querySelectorAll("a"), (a) => a.getAttribute("href"))).toEqual([
      "/@alex/studio/trip/new?start=2026-09-28&end=2026-09-30",
      "/@alex/studio/day/new?photos=2026-09-28",
    ]);
    expect(cards[3].textContent).toContain("2 photos have no date");
    expect(cards[3].querySelector("a")?.getAttribute("href")).toBe("/@alex/studio/day/new?photos=undated");
  });

  test("five cards, then the rest behind one button", () => {
    const el = render({
      ...NOT_DURING_TRIP,
      waitingDays: { cards: ["01", "02", "03", "04", "05", "06", "07"].map((d) => card(`2026-09-${d}`, 1)), undatedIds: [] },
    });
    expect(el.querySelectorAll("[data-day-card]")).toHaveLength(5);
    const more = Array.from(el.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent === "Show 2 more days")!;
    act(() => more.click());
    expect(el.querySelectorAll("[data-day-card]")).toHaveLength(7);
  });

  test("a run of uncovered days proposes its trip once, on its first card", () => {
    const run = { start: "2026-04-10", end: "2026-04-13" };
    const el = render({
      ...NOT_DURING_TRIP,
      waitingDays: { cards: ["10", "11", "13"].map((d) => card(`2026-04-${d}`, 1, { newTrip: run })), undatedIds: [] },
    });
    expect(Array.from(el.querySelectorAll('[data-day-card] a[href*="trip/new"]'), (a) => a.textContent)).toEqual(["Start a trip for 10 Apr – 13 Apr"]);
  });

  test("nothing waiting: no section at all, not an empty panel", () => {
    expect(render({ ...NOT_DURING_TRIP, waitingDays: { cards: [], undatedIds: [] } }).querySelector("[data-waiting-days]")).toBeNull();
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

/**
 * B2304 — the hero, chosen by state: during a trip (write, or told already),
 * a trip starting tomorrow, between trips, or an empty journal. Never more
 * than one applies, so exactly one hero renders.
 */
describe("B2304 — the hero, chosen by state", () => {
  test("during a trip, told already: names the day, says it is not published, not to tell about today again", () => {
    const el = render({
      ...FULL_BASE,
      toldToday: true,
      toldTodayDay: { title: "Baths and the bastion", published: false, slug: "baths-and-the-bastion" },
    });
    const hero = el.querySelector("a[data-hero]")!;
    // B2676, decision 10 — "Today: “{title}” · Not published yet".
    expect(hero.textContent).toContain("Baths and the bastion");
    expect(hero.textContent).toContain("Not published yet");
    expect(hero.textContent).toContain("Continue today");
    // B2702 — opens the day just written, on the edit flow, never a fresh
    // "day/new" that would ask "Add this to it?" about its own words.
    expect(hero.getAttribute("href")).toBe("/@alex/studio/day/edit?slug=baths-and-the-bastion");
    const alt = el.querySelector("a[data-hero-alt]")!;
    expect(alt.textContent).toBe("Change it");
    expect(alt.getAttribute("href")).toBe("/@alex/studio/day/edit");
    expect(el.textContent).not.toContain("Tell about today");
  });

  test("B2702 — a day with no title is named by its date, never 'Untitled'", () => {
    const el = render({
      ...FULL_BASE,
      toldToday: true,
      toldTodayDay: { title: "", published: false, slug: "2026-01-05" },
    });
    const hero = el.querySelector("a[data-hero]")!;
    expect(hero.textContent).not.toContain("Untitled");
    expect(hero.getAttribute("href")).toBe("/@alex/studio/day/edit?slug=2026-01-05");
  });

  test("a trip starting tomorrow gets the plan hero, not a generic 'start a trip' one", () => {
    const el = render({
      ...FULL_BASE,
      addDayTrip: null,
      planTrip: { id: "jp", title: "Japan" },
      facts: { ...FULL_BASE.facts, planStartsInDays: 1 },
    });
    const hero = el.querySelector("a[data-hero]")!;
    expect(hero.textContent).toContain("Get ready for Japan");
    expect(hero.getAttribute("href")).toBe("/@alex/studio/plan/jp");
  });

  test("a trip starting today (not yet declared current) also gets the plan hero", () => {
    const el = render({
      ...FULL_BASE,
      addDayTrip: null,
      planTrip: { id: "jp", title: "Japan" },
      facts: { ...FULL_BASE.facts, planStartsInDays: 0 },
    });
    expect(el.querySelector("a[data-hero]")!.textContent).toContain("Get ready for Japan");
  });

  test("a trip further out than tomorrow does not trigger the plan hero", () => {
    const el = render({
      ...FULL_BASE,
      addDayTrip: null,
      planTrip: { id: "jp", title: "Japan" },
      facts: { ...FULL_BASE.facts, planStartsInDays: 2 },
    });
    expect(el.querySelector("a[data-hero]")!.textContent).toContain("Start a trip");
  });

  test("between trips: no alt link at all", () => {
    const el = render({ ...FULL_BASE, addDayTrip: null });
    expect(el.querySelector("a[data-hero-alt]")).toBeNull();
  });
});

/**
 * B2304, trimmed by B2600 — during a trip only, the full "Waiting for your
 * words" card list is replaced by at most one row: photos still waiting for
 * words on this trip. Publish and A postcard used to ride along here too,
 * duplicating Today's own card and Print's own row (B2580) — gone now that
 * Today's card is unconditional.
 */
describe("B2304/B2600 — during a trip, at most one shortcut row", () => {
  test("no full waiting-days card list renders during a trip", () => {
    const el = render({
      ...FULL_BASE,
      waitingDays: {
        cards: [{ date: "2026-09-22", photoIds: ["a.jpg"], place: null, trip: { id: "alps-2024", title: "Four days round the Alps" }, newTrip: null }],
        undatedIds: [],
      },
    });
    expect(el.querySelector("[data-waiting-days]")).toBeNull();
    expect(el.querySelector("[data-during-trip-rows]")).not.toBeNull();
  });

  test("photos waiting for this trip become one row naming the count", () => {
    const el = render({
      ...FULL_BASE,
      waitingDays: {
        cards: [
          { date: "2026-09-22", photoIds: ["a.jpg"], place: null, trip: { id: "alps-2024", title: "Four days round the Alps" }, newTrip: null },
          { date: "2026-09-23", photoIds: ["b.jpg"], place: null, trip: { id: "alps-2024", title: "Four days round the Alps" }, newTrip: null },
          // A different trip's waiting day does not count here.
          { date: "2026-09-24", photoIds: ["c.jpg"], place: null, trip: { id: "other", title: "Other trip" }, newTrip: null },
        ],
        undatedIds: [],
      },
    });
    const rows = el.querySelectorAll("[data-during-trip-rows] a");
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("Waiting");
    expect(rows[0].textContent).toContain("2 days");
  });

  // B2600 — Publish and A postcard no longer ride along here: Publish is
  // always in Today's own card now, and A postcard only ever in Print.
  test("neither Publish nor A postcard rides along in the shortcut row", () => {
    const el = render({
      ...FULL_BASE,
      facts: { ...FULL_BASE.facts, drafts: 2 },
      waitingDays: {
        cards: [{ date: "2026-09-22", photoIds: ["a.jpg"], place: null, trip: { id: "alps-2024", title: "Four days round the Alps" }, newTrip: null }],
        undatedIds: [],
      },
    });
    const rows = Array.from(el.querySelectorAll("[data-during-trip-rows] a"));
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain("Waiting");
    expect(el.querySelector("[data-during-trip-rows] [data-fact]")).toBeNull();
  });

  test("nothing waiting for this trip: the shortcut is absent entirely", () => {
    const el = render(FULL_BASE);
    expect(el.querySelector("[data-during-trip-rows]")).toBeNull();
  });
});

/** B2304 — no floating pill on the hub any more; the ☰ stays site nav. */
describe("B2304 — no floating pill on the hub", () => {
  test("the hero's own link appears once, not doubled in a bottom bar", () => {
    const el = render(FULL_BASE);
    expect(el.querySelectorAll('a[href="/@alex/studio/day/new"]').length).toBe(1);
    expect(el.textContent).not.toContain("Back to the studio");
  });

  test("the empty state carries no bottom bar either", () => {
    const el = render(EMPTY_BASE);
    expect(el.textContent).not.toContain("Back to the studio");
  });
});

/**
 * B2304, moved to the top by B2641 — one filter field directly under the
 * studio title at every width. An empty query leaves the page unchanged;
 * a non-empty one hides the hero/Today/write section and narrows
 * "Everything else" (reading the exact rows `buildHubGroups` builds for the
 * grid itself, so the two cannot drift apart) and Journal & account to
 * matching rows, opened — down to a "no matches" line when nothing
 * anywhere matches.
 */
describe("B2304/B2641 — the filter, at the top", () => {
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string>) => translate(dictionaryFor("en"), key, vars);
  const tn = (key: Parameters<typeof plural>[1], count: number, vars?: Record<string, string>) => plural(dictionaryFor("en"), key, count, vars);
  const gridSections = (el: HTMLElement) => Array.from(el.querySelectorAll("section[data-group]:not(#journal):not(#write)"));

  test("filterHubGroups narrows to rows matching title or description, derived from buildHubGroups itself", () => {
    const groups = buildHubGroups({ ...FULL_BASE, planTrip: { id: "jp", title: "Japan" } }, "alex", t, tn, "en");
    const expected = groups
      .map((g) => ({ ...g, rows: g.rows.filter((r) => `${r.title} ${r.description ?? r.reason ?? ""}`.toLowerCase().includes("photo")) }))
      .filter((g) => g.rows.length > 0);
    expect(filterHubGroups(groups, "photo")).toEqual(expected);
  });

  test("an empty query changes nothing", () => {
    const groups = buildHubGroups(FULL_BASE, "alex", t, tn, "en");
    expect(filterHubGroups(groups, "")).toBe(groups);
    const el = render(FULL_BASE);
    expect(el.querySelector("#h-today")).not.toBeNull();
    expect(el.querySelector("a[data-hero]")).not.toBeNull();
    expect(el.querySelector("#write")).not.toBeNull();
  });

  test("there is exactly one filter field, directly under the studio title", () => {
    const el = render(FULL_BASE);
    const inputs = el.querySelectorAll<HTMLInputElement>("[data-hub-filter]");
    expect(inputs.length).toBe(1);
    const h1 = el.querySelector("h1")!;
    // The field follows the title and precedes everything it can filter.
    expect(h1.compareDocumentPosition(inputs[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const today = el.querySelector("#h-today")!;
    expect(inputs[0].compareDocumentPosition(today) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  // The ticket's own acceptance, verbatim: typing "gpx" shows the GPX files
  // & routes row.
  test("typing 'gpx' in the filter shows the GPX files & routes row", () => {
    const el = render(FULL_BASE);
    const input = el.querySelector<HTMLInputElement>("[data-hub-filter]")!;
    act(() => typeInto(input, "gpx"));
    expect(el.textContent).toContain("GPX files & routes");
  });

  test("typing in the field narrows the rendered grid to the same rows, and opens the matching cards", () => {
    const t2 = (key: Parameters<typeof translate>[1], vars?: Record<string, string>) => translate(dictionaryFor("en"), key, vars);
    const tn2 = (key: Parameters<typeof plural>[1], count: number, vars?: Record<string, string>) => plural(dictionaryFor("en"), key, count, vars);
    const groups = buildHubGroups(FULL_BASE, "alex", t2, tn2, "en");
    const expected = filterHubGroups(groups, "photo").flatMap((g) => g.rows.map((r) => r.title));

    const el = render(FULL_BASE);
    const input = el.querySelector<HTMLInputElement>("[data-hub-filter]")!;
    act(() => typeInto(input, "photo"));
    const titles = Array.from(el.querySelectorAll("section[data-group]:not(#journal):not(#write) a[data-row]")).map(
      (a) => a.querySelector("[data-desc]")?.previousElementSibling?.querySelector("span")?.textContent ?? a.textContent,
    );
    expect(expected.length).toBeGreaterThan(0);
    for (const title of expected) expect(titles.some((t3) => t3?.includes(title))).toBe(true);
    expect(el.querySelectorAll("section[data-group]:not(#journal):not(#write) a[data-row]").length).toBe(expected.length);
    // Every matching card's own toggle reads open.
    for (const section of gridSections(el)) expect(section.querySelector("button[aria-expanded]")?.getAttribute("aria-expanded")).toBe("true");
  });

  // B2641 — searching is now about finding a flow, not browsing Today's
  // own card; a non-empty query hides the hero and the write list entirely.
  test("a non-empty query hides the hero, the Today heading and the write section", () => {
    const el = render(FULL_BASE);
    const input = el.querySelector<HTMLInputElement>("[data-hub-filter]")!;
    act(() => typeInto(input, "photo"));
    expect(el.querySelector("a[data-hero]")).toBeNull();
    expect(el.querySelector("#h-today")).toBeNull();
    expect(el.querySelector("#write")).toBeNull();
  });

  test("Journal & account hides when none of its rows match, and shows whole when one does", () => {
    const el = render(FULL_BASE);
    const input = el.querySelector<HTMLInputElement>("[data-hub-filter]")!;
    const journalHrefsBefore = Array.from(el.querySelectorAll("#journal a[data-row]")).map((a) => a.getAttribute("href"));
    act(() => typeInto(input, "xyzzy-nothing-matches-this"));
    expect(gridSections(el).length).toBe(0);
    expect(el.querySelector("#journal")).toBeNull();
    act(() => typeInto(input, "visitors"));
    expect(el.querySelector("#journal")).not.toBeNull();
    expect(Array.from(el.querySelectorAll("#journal a[data-row]")).map((a) => a.getAttribute("href"))).toEqual(journalHrefsBefore);
  });

  // B2641's own empty state: nothing anywhere matches.
  test("a query matching nothing anywhere shows the empty state, quoting the query", () => {
    const el = render(FULL_BASE);
    const input = el.querySelector<HTMLInputElement>("[data-hub-filter]")!;
    act(() => typeInto(input, "xyzzy-nothing-matches-this"));
    const empty = el.querySelector("[data-filter-empty]");
    expect(empty).not.toBeNull();
    expect(empty!.textContent).toContain("xyzzy-nothing-matches-this");
  });

  test("the empty state is absent once something (even only Journal & account) matches", () => {
    const el = render(FULL_BASE);
    const input = el.querySelector<HTMLInputElement>("[data-hub-filter]")!;
    act(() => typeInto(input, "visitors"));
    expect(el.querySelector("[data-filter-empty]")).toBeNull();
  });

  test("a clear (x) button appears once typing starts and restores the full page", () => {
    const el = render(FULL_BASE);
    const input = el.querySelector<HTMLInputElement>("[data-hub-filter]")!;
    expect(el.querySelector("[data-hub-filter-clear]")).toBeNull();
    act(() => typeInto(input, "photo"));
    const clear = el.querySelector<HTMLButtonElement>("[data-hub-filter-clear]")!;
    expect(clear).not.toBeNull();
    act(() => clear.click());
    expect(input.value).toBe("");
    expect(gridSections(el).length).toBe(3);
    expect(el.querySelector("#h-today")).not.toBeNull();
    expect(el.querySelector("[data-hub-filter-clear]")).toBeNull();
  });
});

