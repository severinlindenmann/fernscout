import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { forgetEntries, getAllEntries, getAllMedia } from "@/lib/entries";
import { writeDayFixture, writeTripFixture } from "./fixtures/content";

/**
 * What a reader who cannot see the photograph is told — B1867.
 *
 * Every `<img>` in the journal used to say `caption ?? ""`, and a caption is
 * what a picture is *about*, not what is in it. The sentence that is in it is
 * written once into the photograph's sidecar (`described.altText`, B1866) and
 * read from there, so this suite is about exactly one question: which of
 * those sentences, if any, reaches the gallery item.
 *
 * Nothing invented gets rendered: a sidecar that is missing, that carries no
 * `described` block, that carries one in a shape `parseDescribed` refuses, or
 * that describes the picture as the empty string all come back `undefined` —
 * the caption's own fallback, which is what the page did before.
 */

let dir: string;
const REF = "alex/asia-2026";
const SRC = "/media/asia-2026/2026-01-02-arrival/01.jpg";
const META = "alex/trips/asia-2026/meta/2026-01-02-arrival/01.jpg.meta.json";

function writeSidecar(described: unknown) {
  const file = path.join(dir, META);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ filename: "01.jpg", described }, null, 2));
  forgetEntries(REF);
}

function altOfFirstItem(): string | undefined {
  return getAllEntries(REF)[0].gallery[0].alt;
}

/** A whole `described` block in the shape `parseDescribed` accepts, for a
 *  journal written in English and German. Invented on purpose and about
 *  nothing: the photograph it describes is a fixture JPEG that does not
 *  exist, and no person's words are anywhere near it. */
function described(en: string, de: string) {
  return {
    caption: { en: "", de: "" },
    altText: { en, de },
    longDescription: { en: null, de: null },
    tags: [],
    confidence: "low",
    at: "2026-01-02T00:00:00Z",
    model: "test",
    schemaVersion: 1,
    contentHash: "0".repeat(64),
  };
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-alt-"));
  process.env.CONTENT_DIR = dir;
  fs.mkdirSync(path.join(dir, "alex"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ site: { name: "F", url: "https://e.test", defaultUser: "alex" }, users: {}, features: {} }),
  );
  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({
      title: "Alex", tagline: "t", owner: { name: "A B", nickname: "A" },
      startLocation: "X", defaultLocale: "de", locales: ["en", "de"], baseCurrency: "CHF",
      displayCurrencies: ["CHF"], units: "metric", features: {},
    }),
  );
  clearConfigCache();
  clearUserCache();
  writeTripFixture("alex", {
    id: "asia-2026",
    title: "Asia",
    start: "2026-01-01",
    end: "2026-01-09",
    status: "past",
    visibility: "public",
    intro: "Body.",
  });
  writeDayFixture(dir, "alex", "asia-2026", {
    slug: "arrival",
    date: "2026-01-02",
    media: [{ src: SRC, caption: "A caption" }],
  });
  forgetEntries(REF);
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  clearConfigCache();
  clearUserCache();
  forgetEntries(REF);
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("a gallery item's alt text", () => {
  test("is the journal's own default locale, not the first one listed", () => {
    writeSidecar(described("A grey rectangle.", "Ein graues Rechteck."));
    expect(altOfFirstItem()).toBe("Ein graues Rechteck.");
  });

  test("falls back to any locale that has something to say", () => {
    writeSidecar(described("A grey rectangle.", ""));
    expect(altOfFirstItem()).toBe("A grey rectangle.");
  });

  test("is absent when nothing described the photograph", () => {
    expect(altOfFirstItem()).toBeUndefined();
  });

  test("is absent when the sidecar carries no described block", () => {
    writeSidecar(undefined);
    expect(altOfFirstItem()).toBeUndefined();
  });

  test("is absent when the described block is malformed", () => {
    writeSidecar({ altText: "a bare string, not per locale" });
    expect(altOfFirstItem()).toBeUndefined();
  });

  test("is absent when every locale describes it as nothing", () => {
    writeSidecar(described("", ""));
    expect(altOfFirstItem()).toBeUndefined();
  });

  test("reaches the trip-wide grid too", () => {
    writeSidecar(described("A grey rectangle.", "Ein graues Rechteck."));
    expect(getAllMedia(REF)[0].alt).toBe("Ein graues Rechteck.");
  });

  test("leaves the caption alone", () => {
    writeSidecar(described("A grey rectangle.", "Ein graues Rechteck."));
    expect(getAllEntries(REF)[0].gallery[0].caption).toBe("A caption");
  });
});
