import { afterEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { generateMetadata as journalMetadata } from "@/app/[user]/layout";
import { titleWithLocation } from "@/lib/i18n";

/**
 * B418 — a journal with no tagline used to render a dangling em-dash:
 * `<title>The Solo Journal —  · Fernscout</title>`. `tagline` is documented
 * optional and defaults to `""` (lib/config.ts), so the default state of an
 * optional field produced a broken title in the tab, the bookmark and every
 * chat app's card. Fixed by joining the parts that exist rather than
 * interpolating a fixed separator.
 */

let dir: string;

function writeJournal(tagline: string): void {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-tagline-"));
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "F", url: "https://example.test", defaultUser: "ana" },
      users: { reserved: [] },
      features: {},
    }),
  );
  fs.mkdirSync(path.join(dir, "ana", "trips"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "ana", "config.json"),
    JSON.stringify({
      title: "The Solo Journal",
      ...(tagline ? { tagline } : {}),
      owner: { name: "A B", nickname: "A" },
      startLocation: "X",
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
      features: {},
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
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("a journal with no tagline", () => {
  test("has a clean title, with no dangling separator", async () => {
    writeJournal("");
    const meta = await journalMetadata({
      params: Promise.resolve({ user: "ana" }),
      children: null,
    });
    expect((meta.title as { default: string }).default).toBe("The Solo Journal");
  });

  test("a journal with a tagline still joins both parts", async () => {
    writeJournal("one journey, kept back");
    const meta = await journalMetadata({
      params: Promise.resolve({ user: "ana" }),
      children: null,
    });
    expect((meta.title as { default: string }).default).toBe(
      "The Solo Journal — one journey, kept back",
    );
  });
});

describe("titleWithLocation — the same pattern, for an entry with no location", () => {
  test("joins nothing extra when there is no location", () => {
    expect(titleWithLocation("Into the hills", "")).toBe("Into the hills");
  });

  test("joins both when there is a location", () => {
    expect(titleWithLocation("Into the hills", "Salta")).toBe("Into the hills — Salta");
  });
});
