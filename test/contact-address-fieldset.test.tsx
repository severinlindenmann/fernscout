import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { GuestForm } from "@/components/ContactsAdmin";
import { dictionaryFor } from "@/lib/locales";

/**
 * B383 — the address fieldset used to share `postcardsEnabled`'s gate with
 * the postcard consent checkbox, so a server with no print provider gave the
 * owner nowhere to type an address at all — even though
 * `app/api/contacts/admin/route.ts` already stores one regardless of
 * `wantsPostcard`. Only the checkbox is a postcard-specific opt-in; the
 * address itself is the owner's own address book.
 */

const en = dictionaryFor("en");

describe("the owner's address fieldset survives postcards being off", () => {
  test("postcardsEnabled={false}: address inputs present, postcard checkbox gone", () => {
    const html = renderToStaticMarkup(
      <GuestForm
        contact={null}
        fallbackLocale="en"
        locales={["en"]}
        t={(key) => en[key] ?? key}
        busy={false}
        act={async () => null}
        onClose={() => {}}
        postcardsEnabled={false}
      />,
    );
    expect(html).toContain('id="guest-addr-line1"');
    expect(html).toContain('id="guest-addr-city"');
    // No id on the checkbox itself — its label text is the only marker.
    expect(html).not.toContain(en["contact.adminWantsPostcard"]);
    // The hint must not promise a postcard this server cannot send.
    expect(html).toContain(en["contact.adminAddressHintNoPostcards"]);
    // Server-rendered HTML entity-escapes the apostrophe in the other hint,
    // so this checks the un-escaped part of the sentence is absent.
    expect(html).not.toContain("real postcard in the mail");
  });

  test("postcardsEnabled={true}: postcard checkbox is back, and the hint says so", () => {
    const html = renderToStaticMarkup(
      <GuestForm
        contact={null}
        fallbackLocale="en"
        locales={["en"]}
        t={(key) => en[key] ?? key}
        busy={false}
        act={async () => null}
        onClose={() => {}}
        postcardsEnabled
      />,
    );
    expect(html).toContain('id="guest-addr-line1"');
    expect(html).toContain(en["contact.adminWantsPostcard"]);
    // Server-rendered HTML entity-escapes the apostrophe in the hint text.
    expect(html).not.toContain(en["contact.adminAddressHintNoPostcards"]);
  });
});
