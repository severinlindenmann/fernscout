import { afterEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * B357 — a trip or a day page kept its `<title>` in the journal's default
 * language while its `<h1>` and every other string on the page were
 * translated. The German title was in the same frontmatter the heading is
 * read from (`trip.translations` / `entry.translations`) — nothing was
 * reading it into `generateMetadata`.
 *
 * `requestLocale()` is the rule `<html lang>` and the body already use (B140);
 * these are the two `generateMetadata`s that never consulted it for the
 * page's *content*, as opposed to its chrome.
 */

const request = vi.hoisted(() => ({
  cookieLocale: undefined as string | undefined,
  path: "/alex/trips/andes-2025",
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => (request.cookieLocale ? { value: request.cookieLocale } : undefined),
  }),
  headers: async () => ({ get: () => request.path }),
}));

import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { clearLocaleCache } from "@/lib/locales";
import { generateMetadata as tripMetadata } from "@/app/[user]/trips/[trip]/page";
import { generateMetadata as dayMetadata } from "@/app/[user]/trips/[trip]/day/[slug]/page";
import { dayToJson, tripToJson, type DayFile, type TripFile } from "@/lib/api/v2/documents";

const SERVER_CFG =
  '{"site":{"name":"F","url":"https://example.test","defaultUser":"alex"},"users":{"reserved":[]},"features":{}}';

function journal(): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trip-day-title-i18n-"));
  fs.writeFileSync(path.join(dir, "config.json"), SERVER_CFG);
  const trip = path.join(dir, "alex", "trips", "andes-2025");
  fs.mkdirSync(path.join(trip, "entries"), { recursive: true });
  const tripFile: TripFile = {
    id: "andes-2025",
    title: "The long way to Salta",
    dates: { from: "2025-05-01", to: "2025-05-10" },
    visibility: "public",
    people: [],
    intro: "Intro.",
    translations: { de: { title: "Der lange Weg nach Salta" } },
  };
  fs.writeFileSync(path.join(trip, "trip.json"), tripToJson(tripFile));
  const day: DayFile = {
    slug: "salta",
    title: "Into the hills",
    date: "2025-05-02",
    location: "Salta",
    content: "Some prose.",
    status: "published",
    translations: { de: { title: "In die Berge", content: "Text." } },
  };
  fs.writeFileSync(path.join(trip, "entries", "2025-05-02-salta.json"), dayToJson(day));
  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({
      title: "A journal",
      tagline: "t",
      owner: { name: "A B", nickname: "A" },
      startLocation: "X",
      defaultLocale: "en",
      locales: ["en", "de"],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
      features: {},
    }),
  );
  process.env.CONTENT_DIR = dir;
  clearConfigCache();
  clearUserCache();
  clearLocaleCache();
}

afterEach(() => {
  delete process.env.CONTENT_DIR;
  request.cookieLocale = undefined;
  request.path = "/alex/trips/andes-2025";
  clearConfigCache();
  clearUserCache();
  clearLocaleCache();
});

describe("a trip page read in German", () => {
  test("the tab title is the translated title, and the share card stays as written", async () => {
    journal();
    request.cookieLocale = "de";
    const meta = await tripMetadata({
      params: Promise.resolve({ user: "alex", trip: "andes-2025" }),
      searchParams: Promise.resolve({}),
    });

    expect(meta.title).toBe("Der lange Weg nach Salta");
    expect(meta.openGraph?.title).toBe("The long way to Salta");
  });

  test("falls back to the written title when there is no translation", async () => {
    journal();
    request.cookieLocale = "hu"; // installed, not offered by this journal → falls back

    const meta = await tripMetadata({
      params: Promise.resolve({ user: "alex", trip: "andes-2025" }),
      searchParams: Promise.resolve({}),
    });
    expect(meta.title).toBe("The long way to Salta");
  });
});

describe("a day page read in German", () => {
  test("the tab title is the translated title; the location is never translated", async () => {
    journal();
    request.cookieLocale = "de";
    request.path = "/alex/trips/andes-2025/day/salta";
    const meta = await dayMetadata({
      params: Promise.resolve({ user: "alex", trip: "andes-2025", slug: "salta" }),
      searchParams: Promise.resolve({}),
    });

    expect(meta.title).toBe("In die Berge — Salta");
    expect(meta.openGraph?.title).toBe("Into the hills — Salta");
  });

  test("falls back to the written title when there is no translation", async () => {
    journal();
    request.cookieLocale = "hu";
    request.path = "/alex/trips/andes-2025/day/salta";

    const meta = await dayMetadata({
      params: Promise.resolve({ user: "alex", trip: "andes-2025", slug: "salta" }),
      searchParams: Promise.resolve({}),
    });
    expect(meta.title).toBe("Into the hills — Salta");
  });
});
