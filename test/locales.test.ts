import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
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
      owner: { name: "A B", nickname: "A" },
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

  /**
   * B279: a key rendered to a reader is certainly wrong for everybody who
   * sees it, so `translate()` falls through — the requested locale, then
   * English, then the key — and the last two steps are loud in the log
   * rather than only visible on the page.
   */
  describe("the fallback chain, and what it logs (B279)", () => {
    let spy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      spy = vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
      spy.mockRestore();
    });

    test("a key present in the requested locale needs nothing else, and logs nothing", () => {
      expect(translate({ "nav.gallery": "Bilder" }, "nav.gallery", undefined, { "nav.gallery": "Pictures" })).toBe(
        "Bilder",
      );
      expect(spy).not.toHaveBeenCalled();
    });

    test("a key missing from the requested locale renders the English string, and logs", () => {
      expect(translate({}, "nav.gallery", undefined, { "nav.gallery": "Pictures" })).toBe(
        "Pictures",
      );
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0]?.[0]).toContain("nav.gallery");
    });

    test("a key missing everywhere renders the key, and logs", () => {
      expect(translate({}, "nav.gallery", undefined, {})).toBe("nav.gallery");
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0]?.[0]).toContain("nav.gallery");
    });
  });

  test("translateIn resolves the dictionary from the locale", () => {
    expect(translateIn("de", "nav.gallery")).toBe(dictionaryFor("de")["nav.gallery"]);
    expect(translateIn("hr", "nav.gallery")).toBe(dictionaryFor("en")["nav.gallery"]);
  });

  /** The same fallback, exercised through the server-facing entry point:
   * a locale that ships no chrome renders English, loudly, rather than
   * silently — and never a bare key, since English always has this one. */
  test("translateIn logs when it falls back to English", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(translateIn("hr", "nav.gallery")).toBe(dictionaryFor("en")["nav.gallery"]);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
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
/**
 * B432: four German strings addressed the reader as "Sie" (formal) while
 * the rest of the dictionary uses "du" (informal). Not a blanket "no Sie"
 * check — a sentence-initial, capitalised "Sie" is often just "sie" (she/it/
 * they) capitalised by ordinary German grammar, e.g. "Die Seite … Sie zeigt
 * dir …", and that is legitimate and stays. So this pins the four keys that
 * were actually wrong, rather than grepping the whole file.
 */
describe("German address is consistently informal (B432)", () => {
  const formalMarkers = /\b(Sie|Ihnen|Ihre[nrms]?|Ihres)\b/;

  test("the four keys that used formal address now use du", () => {
    const de = dictionaryFor("de");
    for (const key of ["me.signinExpired", "me.signinThrottled", "signin.body", "signin.failed"]) {
      expect(de[key], key).not.toMatch(formalMarkers);
    }
  });
});

/**
 * B481: the same four sign-in-path keys addressed the reader as "Ön" (formal)
 * in Hungarian while the rest of the dictionary uses "te" (informal). Not a
 * blanket "no Ön" check — "Önmagában" ("by itself") contains the string "Ön"
 * but isn't the formal pronoun, the same shape as German's sentence-initial
 * "Sie" false positives — so this pins the four keys that were actually
 * wrong, rather than grepping the whole file.
 */
describe("Hungarian address is consistently informal (B481)", () => {
  const formalMarkers = /\b(Ön|Önt|Önnek|Öné|Önnel|Önök\w*|Kérjen|Várjon|Nyomja|próbálja|kérjen)\b/;

  test("the four keys that used formal address now use te", () => {
    const hu = dictionaryFor("hu");
    for (const key of ["me.signinExpired", "me.signinThrottled", "signin.body", "signin.failed"]) {
      expect(hu[key], key).not.toMatch(formalMarkers);
    }
  });
});

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

/**
 * The dictionary a running process is serving, versus the one on disk.
 *
 * B59: this cache was populated once and never invalidated, so a string added
 * to a locale file rendered as its own key — `map.titlePlanned`, in an `<h1>` —
 * until somebody restarted the server. Adding a *day* showed up on the next
 * request, in the same process, because `lib/entries.ts` fingerprints its
 * files; adding a *string* did not.
 *
 * The case worth being explicit about is the one B56 creates: a deploy
 * replaces `$CONTENT_DIR/locales/` underneath a process that is already
 * running and already serving. Neither half is much use alone — one gets the
 * file onto the machine, the other makes the machine notice.
 */
describe("a locale file that changes under a running process", () => {
  const overrideDir = () => path.join(dir, "locales");
  const writeOverride = (code: string, strings: Record<string, string>) => {
    fs.mkdirSync(overrideDir(), { recursive: true });
    fs.writeFileSync(path.join(overrideDir(), `${code}.json`), JSON.stringify(strings));
  };

  test("a key added to an override file is served without a restart", () => {
    writeOverride("en", { "nav.map": "Chart" });
    expect(dictionaryFor("en")["nav.map"]).toBe("Chart");

    writeOverride("en", { "nav.map": "Chart", "nav.gallery": "Pictures, mostly" });

    expect(dictionaryFor("en")["nav.gallery"]).toBe("Pictures, mostly");
  });

  test("a reworded string replaces the one already being served", () => {
    writeOverride("de", { "nav.map": "Karte" });
    expect(dictionaryFor("de")["nav.map"]).toBe("Karte");

    writeOverride("de", { "nav.map": "Landkarte" });

    expect(dictionaryFor("de")["nav.map"]).toBe("Landkarte");
    expect(translateIn("de", "nav.map")).toBe("Landkarte");
  });

  /**
   * The deploy case. Before the sync there is no override at all, and "no file"
   * has to be part of the fingerprint or the first one to arrive is invisible.
   */
  test("an override file appearing for the first time is noticed", () => {
    const shipped = dictionaryFor("de")["nav.map"];
    expect(shipped).toBeTruthy();

    writeOverride("de", { "nav.map": "Ein anderes Wort" });

    expect(dictionaryFor("de")["nav.map"]).toBe("Ein anderes Wort");
  });

  /** And a key deleted from the override falls back to the shipped string. */
  test("a key removed from an override stops being served", () => {
    const shipped = dictionaryFor("de")["nav.map"];
    writeOverride("de", { "nav.map": "Landkarte", "nav.gallery": "Bilder" });
    expect(dictionaryFor("de")["nav.map"]).toBe("Landkarte");

    writeOverride("de", { "nav.gallery": "Bilder" });

    expect(dictionaryFor("de")["nav.map"]).toBe(shipped);
  });

  /**
   * The other half of the bargain: this runs on every server render, so an
   * unchanged dictionary must cost a `stat` and not a parse of every string.
   */
  test("an untouched dictionary is not re-read on every call", () => {
    writeOverride("de", { "nav.map": "Karte" });
    dictionaryFor("de");

    const read = vi.spyOn(fs, "readFileSync");
    try {
      for (let i = 0; i < 5; i += 1) dictionaryFor("de");
      const localeReads = read.mock.calls.filter(([file]) =>
        String(file).includes(`${path.sep}locales${path.sep}`),
      );
      expect(localeReads).toHaveLength(0);
    } finally {
      read.mockRestore();
    }

    // …and it starts reading again the moment the file moves.
    writeOverride("de", { "nav.map": "Karte", "nav.gallery": "Bilder" });
    expect(dictionaryFor("de")["nav.gallery"]).toBe("Bilder");
  });

  /**
   * B279's investigation half: a file that fails to read or parse used to be
   * indistinguishable from one that simply does not exist. It still degrades
   * to the shipped string either way — there is nothing else to fall back
   * to — but it no longer does so in silence.
   */
  test("an override that fails to parse warns, and the shipped string underneath still comes through", () => {
    fs.mkdirSync(overrideDir(), { recursive: true });
    fs.writeFileSync(path.join(overrideDir(), "de.json"), "{ not json");

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      // The broken override contributes nothing at all — not a throw, not a
      // partially-parsed object — but the *shipped* German string, read from
      // a different, untouched file, is unaffected by it.
      expect(dictionaryFor("de")["nav.gallery"]).toBeTruthy();
      expect(dictionaryFor("de")["nav.gallery"]).not.toBe("nav.gallery");
      expect(warn).toHaveBeenCalled();
      expect(String(warn.mock.calls[0]?.[0])).toContain("de.json");
    } finally {
      warn.mockRestore();
    }
  });

  /**
   * B284: the non-ENOENT branch above used to write its (empty, for that
   * file) result into the cache under the file's own, unchanged signature —
   * so a transient failure was served for the rest of the process's life,
   * indistinguishable from a real edit. Nothing here touches the file
   * between the two calls: the signature is identical both times, so a
   * second, different answer is only possible if the failed read was never
   * cached.
   */
  test("a transient, non-ENOENT read failure is not cached — the next call retries", () => {
    writeOverride("de", { "nav.map": "Sonderkarte" });
    const overridePath = path.join(overrideDir(), "de.json");
    const real = fs.readFileSync.bind(fs);
    let thrown = false;
    const readSpy = vi
      .spyOn(fs, "readFileSync")
      .mockImplementation((file: fs.PathOrFileDescriptor, opts?: unknown) => {
        if (!thrown && String(file) === overridePath) {
          thrown = true;
          const err = new Error("boom") as NodeJS.ErrnoException;
          err.code = "EACCES";
          throw err;
        }
        return real(file, opts as never);
      });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      // First call hits the injected failure: the override contributes
      // nothing, so this falls back to the shipped string underneath.
      const shipped = dictionaryFor("de")["nav.map"];
      expect(shipped).not.toBe("Sonderkarte");
      expect(warn).toHaveBeenCalled();

      // The file on disk never changed — same mtime, same size — so the
      // only way the next call can see the override is if the failed read
      // was never written into the cache.
      expect(dictionaryFor("de")["nav.map"]).toBe("Sonderkarte");
    } finally {
      readSpy.mockRestore();
      warn.mockRestore();
    }
  });
});
