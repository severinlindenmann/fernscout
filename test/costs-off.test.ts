import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

/**
 * B165, the other half: what happens to the numbers that are *not* on a costs
 * page.
 *
 * `test/costs-capability.test.ts` asserts the two pages are gone. This asserts
 * the money is gone with them — the per-day badge in the story feed and the
 * spend block both come through `showCosts`, which is `mayViewCosts`, and that
 * is the one call every costs-rendering path makes. Gating there rather than
 * in each page is what makes "no costs page" and "no costs anywhere" the same
 * decision.
 *
 * Driven from a real `config.json` rather than a mocked `isEnabled`, because
 * the thing that was broken was the wiring between the two: `/api/health` read
 * the file and said off, and every page read nothing and rendered on.
 */

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

let dir: string;

function writeConfigs(serverCosts: boolean | undefined, userCosts: boolean | undefined) {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: "ana" },
      users: { reserved: [] },
      features: serverCosts === undefined ? {} : { costs: { enabled: serverCosts } },
    }),
  );
  fs.mkdirSync(path.join(dir, "ana"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "ana", "config.json"),
    JSON.stringify({
      title: "Two Backpacks",
      owner: { name: "Ana Meyer", nickname: "Ana", email: "ana@example.test" },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      ...(userCosts === undefined ? {} : { features: { costs: { enabled: userCosts } } }),
    }),
  );
  fs.mkdirSync(path.join(dir, "bo"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "bo", "config.json"),
    JSON.stringify({
      title: "Bo's book",
      owner: { name: "Bo Neri", nickname: "Bo", email: "bo@example.test" },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
    }),
  );
}

function writeTrip(username: string, id: string) {
  const root = path.join(dir, username, "trips", id);
  fs.mkdirSync(path.join(root, "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "trip.md"),
    [
      "---",
      `id: "${id}"`,
      `title: "${id}"`,
      'start: "2026-08-25"',
      'end: "2026-08-26"',
      'status: "past"',
      'visibility: "public"',
      // Public money on a public trip: nothing about `costsVisibility` should
      // matter here, which is the point — this is the other axis.
      'costsVisibility: "public"',
      "---",
      "",
      "Intro.",
      "",
    ].join("\n"),
  );
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-costs-off-"));
  process.env.CONTENT_DIR = dir;
  vi.resetModules();
});

afterEach(async () => {
  delete process.env.CONTENT_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
});

async function mayViewCostsOf(username: string, id: string): Promise<boolean> {
  const { getTrip } = await import("@/lib/trips");
  const { mayViewCosts } = await import("@/lib/tripGate");
  const trip = getTrip(`${username}/${id}`);
  if (!trip) throw new Error(`no trip ${username}/${id}`);
  return mayViewCosts(trip);
}

describe("a public trip whose money nothing hides", () => {
  test("shows its costs while the capability is on", async () => {
    writeConfigs(undefined, undefined);
    writeTrip("ana", "asia-2023");
    expect(await mayViewCostsOf("ana", "asia-2023")).toBe(true);
  });

  test("shows none once the instance switches spending off", async () => {
    writeConfigs(false, undefined);
    writeTrip("ana", "asia-2023");
    expect(await mayViewCostsOf("ana", "asia-2023")).toBe(false);
  });

  /**
   * A journal may narrow what the instance allows. Before this, that narrowing
   * did nothing at all.
   */
  test("one journal's no is not another journal's", async () => {
    writeConfigs(undefined, false);
    writeTrip("ana", "asia-2023");
    writeTrip("bo", "alps-2024");
    expect(await mayViewCostsOf("ana", "asia-2023")).toBe(false);
    expect(await mayViewCostsOf("bo", "alps-2024")).toBe(true);
  });

  /**
   * `/api/health` is where an operator is told why something is off, and the
   * running site now agrees with it. That agreement is the whole ticket: the
   * old behaviour was health saying `{"enabled": false}` over a site that
   * rendered the full budget panel.
   */
  test("health and the site give the same answer", async () => {
    writeConfigs(false, undefined);
    writeTrip("ana", "asia-2023");
    const { resolveCapabilities } = await import("@/lib/capabilities");
    const state = resolveCapabilities("ana").costs;
    expect(state.enabled).toBe(false);
    expect(await mayViewCostsOf("ana", "asia-2023")).toBe(state.enabled);
  });
});
