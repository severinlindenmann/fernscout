import { beforeEach, describe, expect, test, vi } from "vitest";
import type { FeatureName, UserConfig } from "@/lib/config";

/**
 * B44 — where the header's sign-in door gets its answer.
 *
 * The door is drawn in `components/SiteNav.tsx` and rendered there, but what
 * decides whether it may be drawn at all is server config: a journal with
 * `features.auth` off has no form behind `/<user>/me`, and a control marked
 * "Sign in" leading to a page that cannot serve one is the bug already
 * recorded at app/[user]/me/MePageContent.tsx.
 *
 * `SiteNav` is a client component, so the question has to be asked on the
 * server and travel in `SiteSummary`. This asserts that wiring; the markup it
 * produces is `test/site-nav.test.tsx`.
 */

const enabled = vi.fn<(name: FeatureName, username?: string) => boolean>(() => false);

vi.mock("@/lib/capabilities", () => ({
  isEnabled: (name: FeatureName, username?: string) => enabled(name, username),
}));

const user = {
  username: "alex",
  title: "Alex's journal",
  tagline: "t",
  startLocation: "Zurich",
  baseCurrency: "CHF",
  locales: ["en"],
} as unknown as UserConfig;

async function summaryFor() {
  const { siteSummaryFor } = await import("@/lib/site");
  return siteSummaryFor(user, true);
}

beforeEach(() => {
  enabled.mockReset();
});

describe("what the header is told about signing in", () => {
  test("asks `auth` for this journal, not for the instance as a whole", async () => {
    enabled.mockImplementation(() => true);
    expect((await summaryFor()).canSignIn).toBe(true);
    expect(enabled).toHaveBeenCalledWith("auth", "alex");
  });

  test("says no on a journal that has it off, so no door is drawn", async () => {
    enabled.mockImplementation((name) => name !== "auth");
    expect((await summaryFor()).canSignIn).toBe(false);
  });

  /**
   * The constraint the whole design turns on: the affordance must not depend
   * on what the gate removed. `siteSummaryFor` is handed a journal and never
   * its trips, so there is nothing here that could vary with them — this
   * pins that, because the tempting next change is to pass a filtered list in
   * "so the header can be smarter about it".
   */
  test("carries nothing derived from a trip", async () => {
    enabled.mockImplementation(() => true);
    const summary = await summaryFor();
    expect(Object.keys(summary).sort()).toEqual([
      "base",
      "baseCurrency",
      "canSignIn",
      "costsEnabled",
      "locales",
      "signedIn",
      "startLocation",
      "tagline",
      "title",
      "url",
      "username",
    ]);
  });
});
