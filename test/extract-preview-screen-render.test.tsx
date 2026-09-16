// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import PreviewScreen from "@/components/extract/PreviewScreen";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";

/**
 * The run's last screen, rendered — B1751 Task 4.2. Same jsdom + `createRoot`
 * harness as `test/extract-credits-screen.test.tsx`.
 *
 * What this file checks a grep cannot: a finished day actually links to its
 * real page (`/[user]/trips/[trip]/day/[slug]`) rather than to anything this
 * component draws itself, and a run with nothing finished says so honestly
 * instead of showing an empty trip as if it were real.
 */

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  vi.unstubAllGlobals();
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

function baseManifest(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    runId: "run-1",
    owner: "alex",
    createdAt: "2026-09-01T00:00:00.000Z",
    expiresAt: "2026-09-05T00:00:00.000Z",
    tripId: null,
    mode: "type",
    state: "telling",
    photos: [],
    days: [],
    ...overrides,
  };
}

function stubRun(manifest: Record<string, unknown>, groups: unknown[] = [], trip?: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/extract/run")) {
        return { ok: true, json: async () => ({ manifest, groups, questions: {} }) } as Response;
      }
      if (url.includes("/trip?id=")) {
        return trip
          ? ({ ok: true, json: async () => trip } as Response)
          : ({ ok: false, status: 404, json: async () => ({}) } as Response);
      }
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
}

async function render(locale = "en") {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <LocaleProvider locale={locale} dictionary={dictionaryFor(locale)}>
        <PreviewScreen username="alex" runId="run-1" />
      </LocaleProvider>,
    );
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("the preview screen", () => {
  test("a finished day links to its own real page, not anything drawn here", async () => {
    stubRun(
      baseManifest({
        tripId: "japan-2026",
        days: [{ date: "2026-06-01", answered: ["q1"], committed: true, entrySlug: "first-day" }],
      }),
      [{ date: "2026-06-01", photoIds: ["p1"], undated: false }],
    );
    await render();

    const link = container!.querySelector('a[href="/alex/trips/japan-2026/day/first-day"]');
    expect(link).not.toBeNull();
    expect(container!.querySelector('a[href="/alex/trips/japan-2026"]')).not.toBeNull();
  });

  test("a run with nothing committed says so, and offers no people form with no trip to add them to", async () => {
    stubRun(baseManifest());
    await render();

    expect(container!.textContent).toContain("None of your days had everything answered");
    expect(container!.querySelector("form")).toBeNull();
  });

  test("a day still carrying open questions is named as skipped, not silently dropped", async () => {
    stubRun(
      baseManifest({
        tripId: "japan-2026",
        days: [{ date: "2026-06-01", answered: ["q1"], committed: true, entrySlug: "first-day" }],
      }),
      [
        { date: "2026-06-01", photoIds: ["p1"], undated: false },
        { date: "2026-06-02", photoIds: ["p2"], undated: false },
      ],
    );
    await render();

    expect(container!.textContent).toContain("One day still has unanswered questions");
  });

  test("a finished day gets a hero and a strip of its own real photographs — B1803 Task 1.3", async () => {
    stubRun(
      baseManifest({
        tripId: "japan-2026",
        // Real rows: a photograph only lands in a dated group because it
        // carries a `takenAt` of its own (`lib/extract/group.ts`), and that
        // reading is what `commitDay` moves it by. The fixture used to
        // carry neither date — nothing the commit path could ever have
        // moved — which is what let the screen's group-based count look
        // right while disagreeing with the journal (final review, finding 3).
        photos: [
          { id: "p1", filename: "p1.jpg", bytes: 1, kind: "image", takenAt: "2026-06-01T09:00:00" },
          { id: "p2", filename: "p2.jpg", bytes: 1, kind: "image", takenAt: "2026-06-01T11:00:00" },
        ],
        days: [{ date: "2026-06-01", answered: ["q1"], committed: true, entrySlug: "first-day" }],
      }),
      [{ date: "2026-06-01", photoIds: ["p1", "p2"], undated: false }],
    );
    await render();

    // The hero — the first finished day's first photograph.
    const hero = container!.querySelector('button[aria-label="p1.jpg"]');
    expect(hero).not.toBeNull();
    expect(hero!.querySelector("img")?.getAttribute("src")).toBe("/api/helper/alex/extract/thumb/run-1/p1");

    // The per-day strip — both of the day's photographs, not just the hero.
    expect(container!.querySelectorAll('button[aria-label="p2.jpg"]').length).toBeGreaterThan(0);
  });

  test("the people form is offered once a trip exists", async () => {
    stubRun(
      baseManifest({
        tripId: "japan-2026",
        days: [{ date: "2026-06-01", answered: ["q1"], committed: true, entrySlug: "first-day" }],
      }),
      [{ date: "2026-06-01", photoIds: ["p1"], undated: false }],
    );
    await render();

    expect(container!.querySelector("form")).not.toBeNull();
    expect(container!.querySelector('a[href="/agent"]')).not.toBeNull();
  });

  test("names the real trip and marks it Draft — B1803 Task 3.7", async () => {
    stubRun(
      baseManifest({
        tripId: "vietnam-2019",
        // Real rows: a photograph only lands in a dated group because it
        // carries a `takenAt` of its own (`lib/extract/group.ts`), and that
        // reading is what `commitDay` moves it by. The fixture used to
        // carry neither date — nothing the commit path could ever have
        // moved — which is what let the screen's group-based count look
        // right while disagreeing with the journal (final review, finding 3).
        photos: [
          { id: "p1", filename: "p1.jpg", bytes: 1, kind: "image", takenAt: "2019-07-02T09:00:00" },
          { id: "p2", filename: "p2.jpg", bytes: 1, kind: "image", takenAt: "2019-07-05T11:00:00" },
        ],
        days: [
          { date: "2019-07-02", answered: ["q1"], committed: true, entrySlug: "day-1" },
          { date: "2019-07-05", answered: ["q1"], committed: true, entrySlug: "day-2" },
        ],
      }),
      [
        { date: "2019-07-02", photoIds: ["p1"], undated: false },
        { date: "2019-07-05", photoIds: ["p2"], undated: false },
      ],
      { title: "Vietnam & Cambodia" },
    );
    await render();

    expect(container!.textContent).toContain("Vietnam & Cambodia");
    expect(container!.textContent).toContain("Draft");
    // Day and photograph counts describe what this run actually committed —
    // never a guess at a trip-wide total this component was never given.
    expect(container!.textContent).toContain("2 days");
    expect(container!.textContent).toContain("2 photographs");
  });

  test("a trip whose title fails to load still shows its real, already-committed days", async () => {
    stubRun(
      baseManifest({
        tripId: "vietnam-2019",
        days: [{ date: "2019-07-02", answered: ["q1"], committed: true, entrySlug: "day-1" }],
      }),
      [{ date: "2019-07-02", photoIds: ["p1"], undated: false }],
    );
    await render();

    expect(container!.querySelector('a[href="/vietnam-2019/day-1"]')).toBeNull();
    expect(container!.querySelector('a[href="/alex/trips/vietnam-2019/day/day-1"]')).not.toBeNull();
    expect(container!.textContent).toContain("Couldn't load the trip's title");
  });

  test("who came, once saved, is named in the summary line — never invented", async () => {
    stubRun(
      baseManifest({
        tripId: "vietnam-2019",
        partySize: 2,
        partyNames: ["Severin", "Nora"],
        days: [{ date: "2019-07-02", answered: ["q1"], committed: true, entrySlug: "day-1" }],
      }),
      [{ date: "2019-07-02", photoIds: ["p1"], undated: false }],
    );
    await render();

    expect(container!.textContent).toContain("Severin");
    expect(container!.textContent).toContain("Nora");
  });
});

/**
 * B1803 final review, findings 3 and 7.
 *
 * Finding 3: this screen counted a day's photographs by the server's own
 * `takenAt` clustering while `ReadyScreen` counted `photo.date` and
 * `lib/extract/commit.ts` moved them by `date ?? takenAt` — three readings
 * of one fact. A photograph the person dated by hand (no `takenAt` of its
 * own, so still in the undated *group*) was committed into the journal and
 * then described here as one that "wasn't added either".
 *
 * Finding 7: `new Intl.ListFormat()` with no locale joins names in English
 * whatever the reader's language is.
 */
describe("the preview screen counts what was really committed", () => {
  const datedByHand = {
    tripId: "japan-2026",
    photos: [
      { id: "p1", filename: "p1.jpg", bytes: 1, kind: "image", takenAt: "2026-06-01T10:00:00" },
      // No `takenAt` — so the server's grouping leaves it in the undated
      // group — but the person set its date on the board, which is what
      // `commitDay` actually moves it by.
      { id: "p2", filename: "p2.jpg", bytes: 1, kind: "image", date: "2026-06-01" },
    ],
    days: [{ date: "2026-06-01", answered: ["q1"], committed: true, entrySlug: "first-day" }],
  };
  const groups = [
    { date: "2026-06-01", photoIds: ["p1"], undated: false },
    { date: "", photoIds: ["p2"], undated: true },
  ];

  test("a photograph the person dated counts as added, and is never called 'not added'", async () => {
    stubRun(baseManifest(datedByHand), groups, { title: "Japan" });
    await render();

    expect(container!.textContent).toContain("2 photographs");
    expect(container!.textContent).not.toMatch(/wasn't added either/);
  });

  test("travellers' names are joined in the reader's own language", async () => {
    stubRun(
      baseManifest({ ...datedByHand, partyNames: ["Nora", "Peter"] }),
      groups,
      { title: "Japan" },
    );
    await render("de");

    expect(container!.textContent).toContain("Nora und Peter");
  });
});
