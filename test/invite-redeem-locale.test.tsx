import { describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import InviteRedeem from "@/components/InviteRedeem";
import { dictionaryFor } from "@/lib/locales";
import { MAINTAINED_LOCALES } from "@/lib/i18n";

/**
 * B279: a guest invite page once rendered every one of its own dictionary
 * keys — `invite.guestTitle`, `contact.name`, `contact.language`, and so on,
 * spanning three different namespaces — instead of any text at all. All
 * eight keys existed in every shipped dictionary; the failure was in
 * whatever the page was handed at that particular render, not in the JSON.
 *
 * This is the reader-facing half of the fix, independent of the cause: no
 * rendered page may show a bare `namespace.key` where a lookup was intended,
 * for any locale this project maintains chrome for.
 */
describe("the invite page never shows a bare key (B279)", () => {
  for (const locale of MAINTAINED_LOCALES) {
    test(`the guest form, in ${locale}`, () => {
      const dictionaries: Record<string, Record<string, string>> = {};
      for (const code of MAINTAINED_LOCALES) dictionaries[code] = dictionaryFor(code);

      const html = renderToStaticMarkup(
        <InviteRedeem
          username="ana"
          journalTitle="Ana's journal"
          kind="guest"
          tripTitle={null}
          token="tok"
          initialLocale={locale}
          locales={[...MAINTAINED_LOCALES]}
          dictionaries={dictionaries}
          knownEmail={null}
          initialName=""
          // Exercises invite.emailPrefilledHint (B338) in every maintained
          // locale, same as every other string on this screen.
          invitedEmail="test@example.com"
          alreadyIn={false}
        />,
      );

      const text = html.replace(/<[^>]*>/g, " ");
      for (const word of text.split(/\s+/)) {
        expect(word).not.toMatch(/^[a-z]+\.[a-zA-Z]+$/);
      }
    });
  }

  /**
   * The failure as it was actually seen: the dictionary a render was handed
   * was empty, not merely missing one string. Even then, the page must show
   * the key rather than nothing — and that path is now logged (B279) — but
   * it still must never be *this* page's bare key in place of its sentences.
   */
  test("an entirely empty dictionary still never mixes in a bare key silently rendered as prose", () => {
    // Every lookup below is a genuine miss and logs — expected and loud by
    // design (B279) — so the spy is here only to keep the test's own output
    // quiet, not to assert on it.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const html = renderToStaticMarkup(
        <InviteRedeem
          username="ana"
          journalTitle="Ana's journal"
          kind="guest"
          tripTitle={null}
          token="tok"
          initialLocale="en"
          locales={["en"]}
          dictionaries={{ en: {} }}
          knownEmail={null}
          initialName=""
          invitedEmail={null}
          alreadyIn={false}
        />,
      );

      // With no dictionary at all there is nothing to fall back to, so the
      // key itself is the honest, documented last resort — but it must stay
      // *recognisable* as a key (this regex), never silently blank or mixed
      // into a sentence that reads as prose.
      const heading = /<h1[^>]*>([^<]*)<\/h1>/.exec(html)?.[1] ?? "";
      expect(heading).toMatch(/^[a-z]+\.[a-zA-Z]+$/);
    } finally {
      spy.mockRestore();
    }
  });
});
