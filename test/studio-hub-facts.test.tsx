// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import StudioHub from "@/components/studio/StudioHub";
import StudioBarProvider from "@/components/studio/StudioBar";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";
import { addDayStorageKey } from "@/lib/studio/addDayResume";
import type { HubFacts, StudioHubModel } from "@/lib/studio/hub";

/**
 * B2067 — the hub's fact chips and the Half done strip.
 *
 * A chip is a neutral fact from data the hub already loads; it renders only
 * when its fact is non-zero, and a draft count never carries an age. The
 * strip gathers the three half-done sources and is absent when all are empty.
 */
vi.mock("@/components/PageHeader", () => ({ default: () => <header /> }));

let root: Root | undefined;
let container: HTMLDivElement | undefined;

beforeEach(() => window.sessionStorage.clear());
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

async function render(model: StudioHubModel) {
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
  await act(async () => {});
  return container;
}

const NO_FACTS: HubFacts = { drafts: 0, inboxCount: 0, inboxBytes: 0, planStartsInDays: null, readersAsking: 0 };

const FULL: Extract<StudioHubModel, { kind: "full" }> = {
  kind: "full",
  account: { credits: null, purchasesOpen: 0, storage: null },
  print: { unfinished: [], recentOrders: [] },
  addDayTrip: { id: "alps", title: "Alps", current: true },
  toldToday: false,
  planTrip: { id: "jp", title: "Japan" },
  cannotRun: { postcard: false, photobook: false, changeDay: false, reshapeDay: false },
  resumableImports: [],
  analyticsEnabled: true,
  postcardSuggestion: null, routeRecordingTrips: [],
  facts: NO_FACTS,
};

const chipOn = (el: HTMLElement, href: string) => el.querySelector(`a[href="${href}"] [data-fact]`)?.textContent ?? null;

describe("fact chips", () => {
  const cases: [string, Partial<HubFacts>, string, string][] = [
    ["drafts (B2140: on Publish a day)", { drafts: 2 }, "/alex/studio/day/publish", "2 drafts"],
    ["plan countdown", { planStartsInDays: 34 }, "/alex/studio/plan/jp", "in 34 days"],
    ["readers asking", { readersAsking: 1 }, "/alex/studio/readers", "1 asking"],
    ["inbox", { inboxCount: 11, inboxBytes: 31 * 1024 * 1024 }, "/alex/studio/inbox", "11 files · 31 MB"],
  ];

  test.each(cases)("%s: a chip when non-zero, nothing at zero", async (_, facts, href, text) => {
    expect(chipOn(await render({ ...FULL, facts: { ...NO_FACTS, ...facts } }), href)).toBe(text);
    act(() => root?.unmount());
    container?.remove();
    expect(chipOn(await render(FULL), href)).toBeNull();
  });

  test("a single draft reads in the singular and carries no date or age", async () => {
    const chip = chipOn(await render({ ...FULL, facts: { ...NO_FACTS, drafts: 1 } }), "/alex/studio/day/publish");
    expect(chip).toBe("1 draft");
    expect(chip).not.toMatch(/\d{4}|ago|old|since|day|week|month/i);
  });

  test("a trip starting today shows no countdown chip", async () => {
    expect(chipOn(await render({ ...FULL, facts: { ...NO_FACTS, planStartsInDays: 0 } }), "/alex/studio/plan/jp")).toBeNull();
  });

  /** Each chip's number has one named source in `buildStudioHubModel`. */
  test("each fact is read from its named source", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "lib/studio/hub.ts"), "utf8");
    expect(src).toMatch(/drafts: days\.flatMap\(\(d\) => d\.entries\)\.filter\(\(e\) => e\.draft\)\.length/);
    expect(src).toMatch(/inboxCount: inbox\.count/);
    expect(src).toMatch(/planStartsInDays: upcoming \? daysUntil\(upcoming\.start\) : null/);
    // B2133 — the readers model's own count; test/readers-model.test.ts
    // proves the chip equals it on a real journal.
    expect(src).toMatch(/readersAsking = isEnabled\("contacts", username\) \? \(await readersModel\(username\)\)\.asking : 0/);
  });
});

describe("the Half done strip", () => {
  const strip = (el: HTMLElement) => el.querySelector("[data-half-done]");

  test("absent when nothing is half done", async () => {
    expect(strip(await render(FULL))).toBeNull();
    act(() => root?.unmount());
    container?.remove();
    expect(strip(await render({ kind: "empty", account: { credits: null, purchasesOpen: 0, storage: null }, print: { unfinished: [], recentOrders: [] }, resumableImports: [], analyticsEnabled: false, postcardSuggestion: null, routeRecordingTrips: [] }))).toBeNull();
  });

  test("gathers the add-day draft, each import and the postcard suggestion, under the hero", async () => {
    window.sessionStorage.setItem(
      addDayStorageKey("alex"),
      JSON.stringify({ step: "which", tripId: "alps", date: "2026-09-20", title: "", content: "", location: "", country: "", savedAt: new Date().toISOString() }),
    );
    const el = await render({
      ...FULL,
      resumableImports: [
        { runId: "r1", createdAt: "2026-09-01T00:00:00.000Z", expiresAt: "2026-09-05T00:00:00.000Z", livePhotoCount: 4, daysLeftToTell: 1, stagedBytes: 12_000_000 },
      ],
      postcardSuggestion: { dayTitle: "Zermatt", dayDate: "2026-09-12", tripTitle: "Alps", dayHref: "/alex/trips/alps/day/zermatt" },
    });
    const s = strip(el)!;
    expect(s).not.toBeNull();
    expect(s.textContent).toContain("Half done");
    // B2304 — one slim line by default: only the add-day draft (the first
    // item built), the rest behind "+2 more".
    expect(s.querySelectorAll("a").length).toBe(1);
    expect(s.textContent).toContain("A day you started, not finished");
    const more = Array.from(s.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent === "+2 more")!;
    expect(more).toBeTruthy();
    act(() => more.click());
    expect(s.querySelectorAll("a").length).toBe(3);
    expect(s.textContent).toContain("A day you started, not finished");
    expect(s.textContent).toContain("4 photographs");
    expect(s.textContent).toContain("Zermatt");
    // Under the hero, above the group cards.
    const hero = el.querySelector("a[data-hero]")!;
    expect(hero.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(s.compareDocumentPosition(el.querySelector("section[data-group]")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  // A day not yet named has `title: ""`, and the card used to print „“ for
  // it. It names the day by its date and trip instead, never by an empty
  // quote or a slug.
  test("names an untitled day by its date and trip, with no empty quotes", async () => {
    const el = await render({
      ...FULL,
      postcardSuggestion: { dayTitle: null, dayDate: "2026-07-14", tripTitle: "Hungary 2026", dayHref: "/alex/trips/hu/day/2026-07-14" },
    });
    const s = strip(el)!;
    expect(s.textContent).toContain("14 July");
    expect(s.textContent).toContain('"Hungary 2026"');
    expect(s.textContent).not.toContain('""');
  });
});

/** B2134 — the chips agree with the pages they summarise. */
describe("B2134 — hub facts and layout", () => {
  const GB = 1024 ** 3;

  test("an inbox under a megabyte reads in kilobytes", async () => {
    const el = await render({ ...FULL, facts: { ...NO_FACTS, inboxCount: 2, inboxBytes: 494 * 1024 } });
    expect(chipOn(el, "/alex/studio/inbox")).toBe("2 files · 494 KB");
  });

  test("the Credits & storage row carries the balance, an amber open purchase and storage", async () => {
    const el = await render({ ...FULL, account: { credits: 59.61, purchasesOpen: 1, storage: { usedBytes: 4 * GB, limitBytes: 10 * GB } } });
    const chips = Array.from(el.querySelectorAll('a[href="/alex/studio/account"] [data-fact]'));
    expect(chips.map((c) => c.textContent)).toEqual(["59.61 credits", "1 open", "4.0 of 10 GB"]);
    expect(chips.map((c) => c.hasAttribute("data-amber"))).toEqual([false, true, false]);
  });

  test("no balance, nothing open and no ceiling: no chips on that row", async () => {
    const el = await render(FULL);
    expect(el.querySelectorAll('a[href="/alex/studio/account"] [data-fact]').length).toBe(0);
  });

  test("storage under a gigabyte keeps its own unit", async () => {
    const el = await render({ ...FULL, account: { credits: null, purchasesOpen: 0, storage: { usedBytes: 3 * 1024 ** 2, limitBytes: 10 * GB } } });
    expect(el.querySelector('a[href="/alex/studio/account"] [data-fact]')?.textContent).toBe("3 MB of 10 GB");
  });

  // B2304 removed the floating phone-bar pill entirely — the hero's own
  // link is the only one wearing its icon now.
  test("no bottom bar repeats the hero's link", async () => {
    const el = await render({ ...FULL, addDayTrip: { id: "jp", title: "Japan", current: false } });
    const hero = el.querySelector("a[data-hero]")!;
    const dupes = Array.from(el.querySelectorAll("a")).filter(
      (a) => a !== hero && a.getAttribute("href") === hero.getAttribute("href"),
    );
    expect(dupes).toHaveLength(0);
  });

  test("Plan has no plan-readers row, and the trip row is called Trips", async () => {
    const el = await render(FULL);
    expect(el.querySelector('#plan a[href="/alex/studio/trip/plan-readers"]')).toBeNull();
    expect(el.querySelector('#plan a[href="/alex/studio/trip"]')?.querySelector("span span")?.textContent).toBe("Trips");
  });

  test("group headers carry no row count", async () => {
    const el = await render(FULL);
    for (const h of Array.from(el.querySelectorAll("section[data-group] h2"))) expect(h.textContent).not.toMatch(/\d/);
  });
});

// B2160 — the Print rows count their own unfinished drafts.
describe("draft chips on the Print rows", () => {
  const unfinished = [
    { kind: "photobook" as const, trip: "alps", tripTitle: "Alps", href: "/alex/trips/alps/photobook", updatedAt: "2026-09-24T10:00:00Z" },
    { kind: "photobook" as const, trip: "jp", tripTitle: "Japan", href: "/alex/trips/jp/photobook", updatedAt: "2026-09-21T10:00:00Z" },
    { kind: "postcard" as const, id: "pc1", href: "/alex/postcards/pc1", recipients: [], updatedAt: "2026-09-19T10:00:00Z" },
  ];

  test("each row counts only its own kind, nothing at zero", async () => {
    const el = await render({ ...FULL, print: { unfinished, recentOrders: [] } });
    expect(chipOn(el, "/alex/studio/photobook")).toBe("2 drafts");
    expect(chipOn(el, "/alex/studio/postcard")).toBe("1 draft");
    act(() => root?.unmount());
    container?.remove();
    const empty = await render(FULL);
    expect(chipOn(empty, "/alex/studio/photobook")).toBeNull();
    expect(chipOn(empty, "/alex/studio/postcard")).toBeNull();
  });
});
