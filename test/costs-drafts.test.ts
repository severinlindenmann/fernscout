import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";

/**
 * B328 — the trap the fix has to avoid, not just the bug it has to fix.
 *
 * `hasCostsData` now asks the days as well as `costs.md` (lib/costs.ts), which
 * means it has to answer the draft question the same way every other reading
 * path in the trip does: a day's spend counts toward "this trip has costs"
 * only for a reader entitled to see that day (`ReadOptions`, lib/entries.ts).
 * Get that wrong and an unpublished day's spend brings a costs page into
 * being for a stranger — which tells them an unpublished day exists, the same
 * class of leak as B296, B318 and B322.
 *
 * The cookie jar is empty throughout: a stranger with the URL, which is who
 * everybody but the owner looks like here. `mayViewCosts` (lib/tripGate.ts)
 * reads the guest cookie through `next/headers` unconditionally — even for a
 * `costsVisibility: public` trip, because it evaluates `isGuestOf` before
 * `maySeeCosts` short-circuits — so this is mocked the same way
 * test/current-trip.test.ts mocks it, for the same reason.
 */

let dir: string;

function writeUser(username: string) {
  fs.mkdirSync(path.join(dir, username), { recursive: true });
  fs.writeFileSync(
    path.join(dir, username, "config.json"),
    JSON.stringify({
      title: `${username}'s journal`,
      tagline: "A tagline",
      owner: { name: "A B", nickname: "A" },
      startLocation: "X",
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
      features: { costs: { enabled: true } },
    }),
  );
}

function writeTrip(username: string, tripId: string) {
  const tripPath = path.join(dir, username, "trips", tripId);
  fs.mkdirSync(path.join(tripPath, "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(tripPath, "trip.md"),
    [
      "---",
      `id: ${tripId}`,
      `title: "${tripId}"`,
      'start: "2026-01-01"',
      'end: "2026-01-31"',
      "status: current",
      "visibility: public",
      "costsVisibility: public",
      "---",
      "",
      "Body.",
      "",
    ].join("\n"),
  );
}

/** The only day this trip has, and its costs are logged on a day that was
 * never published — the trip has no `costs.md` at all. */
function writeDraftCostDay(username: string, tripId: string) {
  fs.writeFileSync(
    path.join(dir, username, "trips", tripId, "entries", "2026-01-02-a-day.md"),
    [
      "---",
      'title: "A day"',
      'date: "2026-01-02"',
      "costs:",
      '  - { label: "Street food", amount: 20, category: "food" }',
      "status: draft",
      "---",
      "",
      "Body.",
      "",
    ].join("\n"),
  );
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-costs-drafts-"));
  process.env.CONTENT_DIR = dir;
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "F", url: "https://example.test", defaultUser: "alex" },
      users: { reserved: [] },
      features: {},
    }),
  );
  writeUser("alex");
  writeTrip("alex", "asia-2026");
  writeDraftCostDay("alex", "asia-2026");
  clearConfigCache();
  clearUserCache();
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
  vi.resetModules();
});

function digestOf(err: unknown): string {
  return typeof err === "object" && err !== null && "digest" in err
    ? String((err as { digest: unknown }).digest)
    : "";
}

/** The current-trip costs page's own output, for the given viewer — the real
 * `page.tsx`, not a call to `hasCostsData`/`getCostSummary` in isolation. */
async function costsPageResult(owner: boolean): Promise<unknown> {
  vi.resetModules();
  vi.doMock("@/lib/contacts/session", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    isOwner: async () => owner,
  }));
  // See the file header: `mayViewCosts` reads the guest cookie unconditionally,
  // even though this trip's `costsVisibility` is public.
  vi.doMock("next/headers", () => ({
    cookies: async () => ({ get: () => undefined }),
  }));
  const { default: CostsPage } = await import("@/app/[user]/(trip)/costs/page");
  return CostsPage({ params: Promise.resolve({ user: "alex" }) } as never);
}

describe("a trip whose only costs are on a day nobody published", () => {
  /** Acceptance's line that matters most. */
  test("a stranger gets no costs page at all", async () => {
    let digest = "";
    try {
      await costsPageResult(false);
    } catch (err) {
      digest = digestOf(err);
    }
    expect(digest).toContain("NEXT_HTTP_ERROR_FALLBACK;404");
  });

  test("the owner sees the page, with the draft day's spend counted", async () => {
    const element = (await costsPageResult(true)) as {
      props: { children: { props: { summary: { total: number } } } };
    };
    expect(element.props.children.props.summary.total).toBe(20);
  });
});
