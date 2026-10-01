import { describe, expect, test } from "vitest";
import { landingHero } from "@/lib/landingContent";
import { translate } from "@/lib/i18n";
import { dictionaryFor } from "@/lib/locales";
import type { TranslationKey } from "@/lib/i18n";

/**
 * B2659 — "no app" is the landing lede's actual selling point for a reader
 * in a browser, and a lie for one reading the same page inside the iPhone
 * shell that `SignedOut.tsx`'s `Hero` renders it in. `nativeShell` picks a
 * sibling key with the same words minus that one claim; every other caller
 * (the server, `lib/landingMarkdown.ts`'s plain-text export, which never
 * runs inside anything) defaults to `false` and keeps saying it, correctly.
 */
const t = (key: TranslationKey, vars?: Record<string, string>) =>
  translate(dictionaryFor("en"), key, vars, dictionaryFor("en"));

describe("landingHero — the app-aware lede", () => {
  test("says 'no app' by default, for the web", () => {
    const hero = landingHero(t, { helperEnabled: false, postcards: false, photobook: false, inviteCta: "request" });
    expect(hero.lede).toContain("no app");
  });

  test("drops the 'no app' claim inside the native shell, keeping the rest", () => {
    const web = landingHero(t, { helperEnabled: false, postcards: false, photobook: false, inviteCta: "request" });
    const app = landingHero(t, {
      helperEnabled: false,
      postcards: false,
      photobook: false,
      inviteCta: "request",
      nativeShell: true,
    });
    expect(app.lede).not.toContain("no app");
    expect(app.lede).toContain("no password");
    expect(app.lede).toContain("no feed");
    // Everything but the dropped clause is the same sentence.
    expect(web.lede.replace("no app, ", "")).toBe(app.lede);
  });

  test("the photobook variant drops it too", () => {
    const app = landingHero(t, {
      helperEnabled: false,
      postcards: false,
      photobook: true,
      inviteCta: "request",
      nativeShell: true,
    });
    expect(app.lede).not.toContain("no app");
    expect(app.lede).toContain("keep the trip as a book");
  });
});
