import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import TripProvider, { useTrip } from "@/components/TripProvider";
import type { Trip } from "@/lib/types";

/**
 * B329 — an owner reported seeing three of nine photographs on the story
 * page. Investigation (recorded in the task file) found the count was
 * `STORY_WINDOW` doing exactly what it is meant to, not a defect — but the
 * owner's link was `/viki#day-hanoi-nachtleben`, and a `#fragment` never
 * reaches the server, so following it opened on the *default* day rather
 * than the one named. `app/TripStory.tsx` wrote that fragment itself, on
 * every scroll, via `history.replaceState(null, "", hashForDay(day))` — so
 * every link an owner ever copied from the address bar mid-story was one of
 * these.
 *
 * The fix threads the real permalink through instead: `/<user>/day/<slug>`
 * is a route of its own (`app/[user]/(trip)/day/[slug]/page.tsx`) that
 * already opens the story window centred on that day server-side — nothing
 * new needed there, and confirmed by `render` in
 * test/day-local-currency.test.tsx already relying on the same `openAt`.
 *
 * What is tested here: the address bar now gets written with `trip.href`
 * rather than the bare hash, and `trip.href` builds exactly the same path
 * the real day-permalink route answers to. What is *not* tested here: the
 * actual browser address bar during a scroll, and a reload of a copied link
 * landing on the right day. Mounting the full story page for a real effect
 * to fire pulls in `motion/react`, `next/image` and `ResizeObserver`
 * (`TripHero`/`MiniMap`, always in the tree even off-screen) that nothing
 * in this suite stubs — a person should open a multi-day trip, scroll to a
 * day, copy the address bar, and open it in a new tab to confirm it lands on
 * that day rather than the trip's default.
 */

describe("TripStory writes a real day permalink to the address bar", () => {
  test("does not call history.replaceState with the bare #day-… hash", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "app/TripStory.tsx"), "utf8");
    // The write path: a day step's replaceState call must go through
    // trip.href, falling back to the hash only when there is no trip (never
    // true in production — TripStory is always rendered inside
    // TripProvider).
    expect(src).toMatch(
      /history\.replaceState\(\s*null,\s*"",\s*trip \? trip\.href\(`\/day\/\$\{day\.slug\}`\) : hashForDay\(day\)\s*\)/,
    );
  });

  test("reading an old #day-… link on arrival is unchanged, for links already shared", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "app/TripStory.tsx"), "utf8");
    expect(src).toContain("window.location.hash.replace(/^#day-/, \"\")");
  });
});

describe("trip.href builds the same path the day-permalink route answers", () => {
  function hrefFor(trip: Partial<Trip>, isCurrent: boolean, path: string) {
    let captured = "";
    function Probe() {
      const ctx = useTrip();
      captured = ctx!.href(path);
      return null;
    }
    renderToStaticMarkup(
      <TripProvider trip={trip as Trip} isCurrent={isCurrent}>
        <Probe />
      </TripProvider>,
    );
    return captured;
  }

  test("the current trip's day permalink has no /trips/<id> segment", () => {
    // Matches app/[user]/(trip)/day/[slug]/page.tsx's own url: `/${user}/day/${slug}`.
    expect(hrefFor({ username: "alex", id: "bangkok-2026" }, true, "/day/hoi-an")).toBe(
      "/alex/day/hoi-an",
    );
  });

  test("a past trip's day permalink carries its trip id", () => {
    // Matches app/[user]/trips/[trip]/day/[slug]/page.tsx's own url:
    // `/${user}/trips/${trip.id}/day/${slug}`.
    expect(hrefFor({ username: "alex", id: "bangkok-2026" }, false, "/day/hoi-an")).toBe(
      "/alex/trips/bangkok-2026/day/hoi-an",
    );
  });
});
