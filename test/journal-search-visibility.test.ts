import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, test, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }), headers: async () => new Headers() }));

/**
 * B2817 — the settings switch "List my journal in search engines" says: off
 * (guest) leaves the journal off this site's lists and sitemap, and every page
 * asks search engines not to show it; on (public) lists it. Pinned here so the
 * sentence cannot drift from what the code does.
 */
let dir: string;

function writeJournal(username: string, visibility: "public" | "guest") {
  fs.mkdirSync(path.join(dir, username), { recursive: true });
  fs.writeFileSync(
    path.join(dir, username, "config.json"),
    JSON.stringify({
      title: username,
      tagline: "t",
      owner: { name: "A B", nickname: "A" },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
      visibility,
    }),
  );
}

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-search-visibility-"));
  process.env.CONTENT_DIR = dir;
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ site: { name: "F", url: "https://example.test" }, users: { reserved: [] }, features: {} }),
  );
  writeJournal("onlist", "public");
  writeJournal("offlist", "guest");
});

afterAll(() => {
  delete process.env.CONTENT_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
});

test("guest is off the listed journals; public is on them", async () => {
  const { clearUserCache, listedUsernames } = await import("@/lib/users");
  clearUserCache();
  expect(listedUsernames()).toContain("onlist");
  expect(listedUsernames()).not.toContain("offlist");
});

test("a guest journal's pages ask search engines not to show it; a public one does not", async () => {
  const { generateMetadata } = await import("@/app/at/[user]/layout");
  const off = await generateMetadata({ params: Promise.resolve({ user: "offlist" }) } as never);
  const on = await generateMetadata({ params: Promise.resolve({ user: "onlist" }) } as never);
  expect(off.robots).toEqual({ index: false, follow: false });
  expect(on.robots).toBeUndefined();
});
