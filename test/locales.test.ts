import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import {
  clearLocaleCache,
  defaultLocaleFor,
  dictionariesFor,
  dictionaryFor,
  instanceLocale,
  installedLocales,
  localeForPath,
  localesFor,
  translateIn,
} from "@/lib/locales";
import { translate } from "@/lib/i18n";

/**
 * The two language layers (ROADMAP §1.2).
 *
 * The property that matters: a journal may be written in a language this
 * project ships no chrome for, and that has to work — English menus around
 * Croatian prose is a deliberate outcome, not a broken one.
 */

let dir: string;

function writeUser(username: string, locales: string[], defaultLocale: string) {
  fs.mkdirSync(path.join(dir, username, "trips"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, username, "config.json"),
    JSON.stringify({
      title: `${username}'s journal`,
      tagline: "t",
      travellers: [{ name: "A B", nickname: "A" }],
      startLocation: "X",
      defaultLocale,
      locales,
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
      features: {},
    }),
  );
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-locales-"));
  process.env.CONTENT_DIR = dir;
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "Fernscout", url: "https://example.test", defaultUser: "ana" },
      users: { reserved: [] },
      features: {},
    }),
  );
  writeUser("ana", ["de", "en"], "de");
  writeUser("bea", ["hr", "en"], "hr"); // a language we ship no chrome for
  clearConfigCache();
  clearUserCache();
  clearLocaleCache();
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  clearConfigCache();
  clearUserCache();
  clearLocaleCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("which languages exist", () => {
  test("the maintained set is what we ship chrome for", () => {
    expect(installedLocales().sort()).toEqual(["de", "en", "hu"]);
  });

  test("a journal's languages come from its own config", () => {
    expect(localesFor("ana")).toEqual(["de", "en"]);
    expect(localesFor("bea")).toEqual(["hr", "en"]);
    expect(defaultLocaleFor("ana")).toBe("de");
  });

  test("pages outside a journal use the default user's language", () => {
    expect(instanceLocale()).toBe("de");
  });
});

describe("dictionaries", () => {
  test("a maintained locale has real strings, not key names", () => {
    const de = dictionaryFor("de");
    expect(de["nav.gallery"]).toBeTruthy();
    expect(de["nav.gallery"]).not.toBe("nav.gallery");
    expect(de["nav.gallery"]).not.toBe(dictionaryFor("en")["nav.gallery"]);
  });

  /** The whole point of the split: chrome falls back, content does not. */
  test("a language we ship no chrome for gets English chrome", () => {
    const hr = dictionaryFor("hr");
    expect(hr["nav.gallery"]).toBe(dictionaryFor("en")["nav.gallery"]);
  });

  test("every maintained locale covers every key English has", () => {
    const english = Object.keys(dictionaryFor("en"));
    for (const code of installedLocales()) {
      const missing = english.filter((k) => !dictionaryFor(code)[k]);
      expect(missing, `${code} is missing: ${missing.slice(0, 5).join(", ")}`).toEqual([]);
    }
  });

  test("dictionariesFor covers exactly what the journal offers", () => {
    expect(Object.keys(dictionariesFor("ana")).sort()).toEqual(["de", "en"]);
    expect(Object.keys(dictionariesFor("bea")).sort()).toEqual(["en", "hr"]);
  });
});

describe("translate", () => {
  test("fills {token} placeholders", () => {
    expect(translate({ greet: "Hallo {name}" }, "greet" as never, { name: "Oma" })).toBe(
      "Hallo Oma",
    );
  });

  test("leaves an unknown token visible rather than blanking it", () => {
    expect(translate({ greet: "Hallo {name}" }, "greet" as never, {})).toBe("Hallo {name}");
  });

  /** A missing string shows as its key: ugly and unmistakable beats a blank. */
  test("falls back to the key itself", () => {
    expect(translate({}, "nav.gallery")).toBe("nav.gallery");
  });

  test("translateIn resolves the dictionary from the locale", () => {
    expect(translateIn("de", "nav.gallery")).toBe(dictionaryFor("de")["nav.gallery"]);
    expect(translateIn("hr", "nav.gallery")).toBe(dictionaryFor("en")["nav.gallery"]);
  });
});

/**
 * `<html lang>` before any cookie.
 *
 * The root layout writes it and sits above `[user]`, so without the path it
 * used the *instance* language: a German journal on an English instance
 * served `lang="en"` with English chrome and corrected itself only once the
 * inner provider hydrated — visible, and already wrong for a reader with no
 * JavaScript or a screen reader that has announced the language.
 */
describe("localeForPath", () => {
  test("a journal's own default, not the instance's", () => {
    expect(localeForPath("/bea")).toBe("hr");
    expect(localeForPath("/bea/trips/x")).toBe("hr");
    expect(localeForPath("/ana")).toBe("de");
  });

  test("the instance language outside a journal", () => {
    expect(localeForPath("/")).toBe(instanceLocale());
    expect(localeForPath("")).toBe(instanceLocale());
    expect(localeForPath(null)).toBe(instanceLocale());
  });

  /** A first segment that names nobody is a 404, not a journal. */
  test("an address that names nobody falls back", () => {
    expect(localeForPath("/nobody")).toBe(instanceLocale());
    expect(localeForPath("/api/health")).toBe(instanceLocale());
  });
});
