import { beforeEach, describe, expect, test, vi } from "vitest";
import type { FeatureName } from "@/lib/config";
import type { Trip } from "@/lib/types";

/**
 * B165 — what "costs is switched off" does to the site.
 *
 * `costs` was a capability everywhere that describes one: in `FEATURE_NAMES`,
 * with a row in `REQUIREMENTS`, declarable per journal, and reported by
 * `/api/health`. Nothing on the way to a costs page asked. An operator who
 * turned spending off got no change at all — both costs pages answered 200
 * with the full budget panel, the totals and the itemised table, while
 * `/api/health` reported `{"enabled": false}`. A capability that is off must
 * be *absent*, and a health endpoint contradicted by the running site is
 * worse than no switch.
 *
 * Two answers, in two places, and both are asserted here:
 *
 *   - the pages are **gone** — `notFound()`, which is what every other
 *     capability-gated route does;
 *   - the numbers are **absent everywhere else** — `mayViewCosts` says no, and
 *     that is the one call every costs-rendering path already makes, so the
 *     story feed's per-day badge and the spend block go with it.
 *
 * `costsVisibility` is a different question and is untouched: that is who
 * among the readers sees the money, not whether this instance does money.
 */

const enabled = vi.fn<(name: FeatureName, username?: string) => boolean>(() => true);

vi.mock("@/lib/capabilities", () => ({
  isEnabled: (name: FeatureName, username?: string) => enabled(name, username),
}));

class NotFound extends Error {}
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFound("notFound");
  },
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));

const trip = {
  id: "asia-2023",
  ref: "alex/asia-2023",
  username: "alex",
  title: "Asia",
  status: "past",
  visibility: "public",
  costsVisibility: "public",
  people: [],
} as unknown as Trip;

vi.mock("@/lib/trips", () => ({
  getTrip: () => trip,
  getTrips: () => [trip],
  // A *different* trip is the journal's current one, so `asia-2023` is a page
  // `generateStaticParams` would otherwise offer. Returning `trip` here made
  // that assertion vacuous: the filter removed the only candidate whatever the
  // capability said.
  getCurrentTrip: () => ({ ...trip, id: "now-2027" }),
  tripRef: (user: string, id: string) => `${user}/${id}`,
}));
vi.mock("@/lib/currentTrip", () => ({ currentTripOrRedirect: () => trip }));
vi.mock("@/lib/users", () => ({
  getUser: () => ({ username: "alex", title: "Alex's journal", baseCurrency: "CHF" }),
  getUsernames: () => ["alex", "robin"],
}));
vi.mock("@/lib/costs", () => ({ getCostSummary: () => ({ total: 1234 }) }));
vi.mock("@/lib/site", () => ({ travellerNamesOf: () => [] }));
vi.mock("@/lib/locales", () => ({
  requestLocale: async () => "en",
  // The journal's own language, for the sharing card. Both costs routes ask
  // for it now (B139); neither reaches the call with the capability off, which
  // is the case under test here.
  localeForPath: () => "en",
  translateIn: (_locale: string, key: string) => key,
}));

// The gate itself is not what is under test here; costs off has to win before
// it is consulted, and a viewer who may read the trip is the harder case.
vi.mock("@/lib/tripGate", () => ({
  mayReadTrip: async () => true,
  mayViewCosts: async () => true,
}));

beforeEach(() => {
  enabled.mockReset();
  enabled.mockImplementation(() => true);
});

async function currentTripCostsPage(user = "alex") {
  const { default: Page } = await import("@/app/[user]/(trip)/costs/page");
  return Page({ params: Promise.resolve({ user }) } as Parameters<typeof Page>[0]);
}

async function tripCostsPage(user = "alex") {
  const { default: Page } = await import("@/app/[user]/trips/[trip]/costs/page");
  return Page({
    params: Promise.resolve({ user, trip: "asia-2023" }),
  } as Parameters<typeof Page>[0]);
}

describe("the costs pages when the capability is off", () => {
  test("/<user>/costs is not there", async () => {
    enabled.mockImplementation((name) => name !== "costs");
    await expect(currentTripCostsPage()).rejects.toBeInstanceOf(NotFound);
    expect(enabled).toHaveBeenCalledWith("costs", "alex");
  });

  test("/<user>/trips/<trip>/costs is not there", async () => {
    enabled.mockImplementation((name) => name !== "costs");
    await expect(tripCostsPage()).rejects.toBeInstanceOf(NotFound);
  });

  test("and with it on, both render", async () => {
    await expect(currentTripCostsPage()).resolves.toBeTruthy();
    await expect(tripCostsPage()).resolves.toBeTruthy();
  });

  /**
   * A journal's own config may narrow what the instance allows, so the
   * question is asked per journal — and the answer has to be per journal too.
   * Turning it off for one must not empty another's pages.
   */
  test("off for one journal is on for the next", async () => {
    enabled.mockImplementation((name, username) => !(name === "costs" && username === "alex"));
    await expect(currentTripCostsPage("alex")).rejects.toBeInstanceOf(NotFound);
    await expect(currentTripCostsPage("robin")).resolves.toBeTruthy();
  });

  /** Nothing describes a page that is not there. */
  test("neither page emits metadata for a journal with it off", async () => {
    enabled.mockImplementation((name) => name !== "costs");
    const current = await import("@/app/[user]/(trip)/costs/page");
    const perTrip = await import("@/app/[user]/trips/[trip]/costs/page");
    expect(
      await current.generateMetadata({ params: Promise.resolve({ user: "alex" }) } as never),
    ).toEqual({});
    expect(
      await perTrip.generateMetadata({
        params: Promise.resolve({ user: "alex", trip: "asia-2023" }),
      } as never),
    ).toEqual({});
  });

  /** And no costs page is prerendered for a journal that has none. */
  test("generateStaticParams offers no costs page for a journal with it off", async () => {
    enabled.mockImplementation((name) => name !== "costs");
    const { generateStaticParams } = await import("@/app/[user]/trips/[trip]/costs/page");
    expect(generateStaticParams()).toEqual([]);
  });

  test("and offers one for a journal that has it on", async () => {
    const { generateStaticParams } = await import("@/app/[user]/trips/[trip]/costs/page");
    expect(generateStaticParams()).toContainEqual({ user: "alex", trip: "asia-2023" });
  });
});
