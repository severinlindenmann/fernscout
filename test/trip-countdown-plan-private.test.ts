import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

/**
 * B2009 — `plan.private` must never reach a reader who is not `person`, and
 * the countdown page is the sharpest place to prove it: `TripPage` hands the
 * WHOLE `Trip` domain object to `TripProvider` and `TripCountdown`, both
 * client components, so whatever survives on `Trip.planSection` is
 * serialised to every visitor's browser regardless of what `getPlan`'s own
 * `PlannedStop[]` projection does. `lib/trips.ts`'s `readTrip` is where this
 * is meant to be stopped — this test is what would have caught it if it
 * were not.
 *
 * No cookie, no bearer token: `next/headers` is mocked to answer as a
 * stranger with no session at all, which is `readerLevelFor`'s `public`.
 */

const request = vi.hoisted(() => ({ path: "/alex/trips/future-plans-2031" }));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => ({ get: () => request.path }),
}));

/**
 * B2012 — the reader-level plumbing that adds `plan.private` back in, for
 * exactly one audience. `isOwner`/`isJournalGuest` are the two branches
 * `readerLevelFor` (lib/tripGate.ts) reaches for a `public` trip like this
 * one's: real by default (both false for a stranger, which the first test
 * below still exercises unmocked) and overridden per test here to reach
 * `person` and `guest` without faking a whole cookie/session stack.
 */
const session = vi.hoisted(() => ({ isOwner: false, isJournalGuest: false }));
vi.mock("@/lib/contacts/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/contacts/session")>();
  return {
    ...actual,
    isOwner: async () => session.isOwner,
    isJournalGuest: async () => session.isJournalGuest,
  };
});

import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import TripPage from "@/app/[user]/trips/[trip]/page";
import TripCountdown from "@/components/TripCountdown";
import { tripToJson, type TripFile } from "@/lib/api/v2/documents";

const SERVER_CFG =
  '{"site":{"name":"F","url":"https://example.test","defaultUser":"alex"},"users":{"reserved":[]},"features":{}}';

let dir: string | undefined;

function journal(readers?: "map" | "details"): void {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "trip-countdown-plan-private-"));
  fs.writeFileSync(path.join(dir, "config.json"), SERVER_CFG);
  const tripDir = path.join(dir, "alex", "trips", "future-plans-2031");
  fs.mkdirSync(tripDir, { recursive: true });
  const tripFile: TripFile = {
    id: "future-plans-2031",
    title: "Some trip, still ahead",
    dates: { from: "2031-05-01", to: "2031-05-10" },
    visibility: "public",
    people: [],
    intro: "Intro.",
    // Content nobody lived — AGENTS.md's one exception — so
    // `recordTripView` (analytics) skips writing anywhere this test has not
    // set up a database for.
    test: true,
    plan: {
      route: [
        {
          id: "riga",
          location: "Riga",
          lat: 56.9496,
          lng: 24.1052,
          nights: 2,
          note: "A note nobody but a details reader should see",
        },
      ],
      ...(readers ? { readers } : {}),
      private: {
        links: [{ label: "Shared notes", url: "https://example.test/notes" }],
        stops: {
          riga: {
            stay: { name: "Some Hotel", lat: 56.95, lng: 24.1 },
            links: [{ label: "Booking confirmation", url: "https://example.test/booking" }],
          },
        },
      },
    },
  };
  fs.writeFileSync(path.join(tripDir, "trip.json"), tripToJson(tripFile));
  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({
      title: "A journal",
      tagline: "t",
      owner: { name: "A B", nickname: "A" },
      defaultLocale: "en",
      locales: ["en"],
    }),
  );
  process.env.CONTENT_DIR = dir;
  clearConfigCache();
  clearUserCache();
}

afterEach(() => {
  delete process.env.CONTENT_DIR;
  clearConfigCache();
  clearUserCache();
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  dir = undefined;
  session.isOwner = false;
  session.isJournalGuest = false;
});

/** A React element, without the DOM's own `Element` — just `{type, props}`,
 * the shape a server component's return value actually has before anything
 * renders it. */
type El = { type: unknown; props?: { children?: unknown } };

function isElement(x: unknown): x is El {
  return typeof x === "object" && x !== null && "type" in x && "props" in x;
}

/** Every element in the tree whose `type` is `target`, found by walking
 * `props.children` — never rendered, so no hook ever runs and no provider
 * this fragment lacks (LocaleProvider, CurrencyProvider — both live higher,
 * in the root layout this test never mounts) is ever needed. */
function findByType(node: unknown, target: unknown, found: El[] = []): El[] {
  if (Array.isArray(node)) {
    for (const n of node) findByType(n, target, found);
    return found;
  }
  if (!isElement(node)) return found;
  if (node.type === target) found.push(node);
  findByType(node.props?.children, target, found);
  return found;
}

describe("the countdown page's own props", () => {
  test("carry no private, stay or url string for a reader with no credential at all", async () => {
    journal();
    const element = await TripPage({
      params: Promise.resolve({ user: "alex", trip: "future-plans-2031" }),
      searchParams: Promise.resolve({}),
    });

    const hits = findByType(element, TripCountdown);
    expect(hits, "TripPage did not render TripCountdown for an upcoming trip with no days").toHaveLength(1);

    const json = JSON.stringify(hits[0].props);
    expect(json).not.toContain("private");
    expect(json).not.toContain("stay");
    expect(json).not.toMatch(/"url"/);
    // The narrower, positive half: the public map projection is still there.
    expect(json).toContain("Riga");
  });

  test("carry no note text at the trip's default `map` reader level", async () => {
    journal();
    const element = await TripPage({
      params: Promise.resolve({ user: "alex", trip: "future-plans-2031" }),
      searchParams: Promise.resolve({}),
    });
    const hits = findByType(element, TripCountdown);
    const json = JSON.stringify(hits[0].props);
    // Not merely unrendered — dropped before the client component ever sees
    // it (lib/plan.ts's `stopsForReaders`), so it is absent from the page's
    // own RSC payload too, not only from what `TripCountdown` chooses to
    // draw.
    expect(json).not.toContain("nobody but a details reader");
    expect(json).toContain("Riga");
  });

  test("carry the note text once the trip's plan.readers is `details`", async () => {
    journal("details");
    const element = await TripPage({
      params: Promise.resolve({ user: "alex", trip: "future-plans-2031" }),
      searchParams: Promise.resolve({}),
    });
    const hits = findByType(element, TripCountdown);
    const json = JSON.stringify(hits[0].props);
    expect(json).toContain("nobody but a details reader");
    // Still nothing of the private layer, for this same public reader.
    expect(json).not.toContain("stay");
    expect(json).not.toMatch(/"url"/);
  });

  test("still carry no stay or url for an approved guest of the journal", async () => {
    journal();
    session.isJournalGuest = true;

    const element = await TripPage({
      params: Promise.resolve({ user: "alex", trip: "future-plans-2031" }),
      searchParams: Promise.resolve({}),
    });

    const hits = findByType(element, TripCountdown);
    expect(hits).toHaveLength(1);
    const json = JSON.stringify(hits[0].props);
    expect(json).not.toContain("stay");
    expect(json).not.toMatch(/"url"/);
    expect(json).toContain("Riga");
  });

  test("carry the stay, the link and a changePlanHref for the trip's owner", async () => {
    journal();
    session.isOwner = true;

    const element = await TripPage({
      params: Promise.resolve({ user: "alex", trip: "future-plans-2031" }),
      searchParams: Promise.resolve({}),
    });

    const hits = findByType(element, TripCountdown);
    expect(hits).toHaveLength(1);
    const props = hits[0].props as Record<string, unknown>;
    expect(props.changePlanHref).toBe("/alex/studio/plan/future-plans-2031");

    const json = JSON.stringify(props);
    expect(json).toContain("Some Hotel");
    expect(json).toContain("https://example.test/booking");
    expect(json).toContain("Shared notes");
  });
});
