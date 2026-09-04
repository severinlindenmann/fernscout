import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import InviteRedeem from "@/components/InviteRedeem";
import { dictionaryFor } from "@/lib/locales";

/**
 * B273 — a brand-new reader is offered a postal address and a phone number on
 * the guest invite form; an already-known reader (the "confirm" step, one
 * button, no form) is not asked about either. `test/invite-links.test.ts`
 * covers the server side of the same split — this is the UI half.
 */
describe("the guest invite form's postal address fields", () => {
  const dictionaries = { en: dictionaryFor("en") };

  function render(knownEmail: string | null) {
    return renderToStaticMarkup(
      <InviteRedeem
        username="ana"
        journalTitle="Ana's journal"
        kind="guest"
        tripTitle={null}
        token="tok"
        initialLocale="en"
        locales={["en"]}
        dictionaries={dictionaries}
        knownEmail={knownEmail}
        initialName=""
        alreadyIn={false}
      />,
    );
  }

  test("a brand-new reader (no known email) is offered an address, a phone number and a postcard box", () => {
    const html = render(null);
    expect(html).toContain('id="invite-tel"');
    expect(html).toContain('id="invite-addr-line1"');
    expect(html).toContain('id="invite-addr-country"');
    expect(html).toContain(dictionaries.en["contact.wantsPostcard"]);
    // The phone field says what it is for, since nothing sends to it yet.
    expect(html).toContain(dictionaries.en["contact.telHint"]);
  });

  test("an already-known reader (the confirm step) sees none of it", () => {
    const html = render("known@example.test");
    expect(html).not.toContain('id="invite-tel"');
    expect(html).not.toContain('id="invite-addr-line1"');
    expect(html).not.toContain(dictionaries.en["contact.wantsPostcard"]);
    // The confirm step's own copy — proof this rendered "confirm", not "form"
    // with the fields simply missing.
    expect(html).toContain("known@example.test");
    expect(html).toContain('type="submit"');
  });
});
