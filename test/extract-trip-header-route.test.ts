import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { writeTripFixture } from "./fixtures/content";

/**
 * `GET .../trip?id=` — the one fact `PreviewScreen` cannot derive from the
 * run's own manifest: a brand-new trip's title, decided server-side by
 * `titleFromSpan` (B1803 Task 3.7). Nothing imported this handler before —
 * the render test only ever mocked `fetch` — so this is the first test that
 * actually calls it.
 */

const owner = { yes: true };
vi.mock("@/lib/helper/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/helper/server")>();
  return { ...actual, isHelperOwner: async () => owner.yes };
});
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));
// `notYourJournal` (called only on the refusal path) asks this itself,
// independent of the `isHelperOwner` mock above — a real signed-in email
// that just isn't this journal's owner, so the refusal takes its
// `not_your_journal` branch rather than `session_lapsed`.
vi.mock("@/lib/auth/handshake", () => ({
  resolveAccess: async () => ({ email: "someone-else@example.test" }),
}));

let dir: string;
beforeEach(() => {
  owner.yes = true;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-trip-header-"));
  process.env.CONTENT_DIR = dir;
  fs.mkdirSync(path.join(dir, "alex"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({
      title: "Alex",
      tagline: "t",
      owner: { name: "A B", nickname: "A", email: "alex@example.test" },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "USD",
    }),
  );
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.CONTENT_DIR;
});

function get(user: string, id?: string) {
  const url = id
    ? `http://x/api/helper/${user}/trip?id=${encodeURIComponent(id)}`
    : `http://x/api/helper/${user}/trip`;
  return import("@/app/api/helper/[user]/trip/route").then(({ GET }) =>
    GET(new Request(url), { params: Promise.resolve({ user }) }),
  );
}

describe("GET .../trip", () => {
  test("a non-owner is refused the same way a missing journal would be", async () => {
    owner.yes = false;
    const res = await get("alex", "some-trip");
    expect(res.status).toBe(404);
  });

  test("an id that names no real trip is unknown_trip, not a 500", async () => {
    const res = await get("alex", "no-such-trip");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "unknown_trip" });
  });

  test("a real trip reads back its own title and dates — the exact shape PreviewScreen fetches", async () => {
    writeTripFixture("alex", { id: "vietnam-2019", title: "Vietnam & Cambodia", start: "2019-07-02", end: "2019-07-04" });

    const res = await get("alex", "vietnam-2019");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ title: "Vietnam & Cambodia", start: "2019-07-02", end: "2019-07-04" });
  });
});
