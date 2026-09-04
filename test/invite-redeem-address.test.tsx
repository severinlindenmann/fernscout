import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import InviteRedeem from "@/components/InviteRedeem";
import { dictionaryFor } from "@/lib/locales";

/**
 * B273 — a brand-new reader is offered a postal address and a phone number on
 * the guest invite form; an already-known reader (the "confirm" step, one
 * button, no form) is not asked about either. `test/invite-links.test.ts`
 * covers the server side of the same split — this is the UI half.
 *
 * B315 put the digest tick on the same side of that split, and it is the box
 * a guest of a travel journal actually expects: the form offered "send me a
 * real postcard" and never "tell me when there is a new day", so a reader who
 * followed an invite was silently answered *no* to the only thing that would
 * ever tell them the journal had been written in.
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

  test("and the digest box, which is the one they came for", () => {
    const html = render(null);
    expect(html).toContain(dictionaries.en["contact.wantsDigest"]);
  });

  /**
   * Ticked by default — the owner's decision, and what `ContactForm` has
   * always done. Two front doors into one contacts table must not disagree
   * about what a reader was taken to have asked for.
   */
  test("the digest box starts ticked and the postcard box does not", () => {
    const html = render(null);
    const boxes = [...html.matchAll(/<input type="checkbox"[^>]*>/g)].map((m) => m[0]);
    expect(boxes).toHaveLength(2);
    expect(boxes[0]).toContain("checked");
    expect(boxes[1]).not.toContain("checked");
  });

  test("an already-known reader (the confirm step) sees none of it", () => {
    const html = render("known@example.test");
    expect(html).not.toContain('id="invite-tel"');
    expect(html).not.toContain('id="invite-addr-line1"');
    expect(html).not.toContain(dictionaries.en["contact.wantsPostcard"]);
    // Nor the digest box: an already-known reader has a stored answer, and a
    // redemption must never rewrite one. B315 did not reopen that.
    expect(html).not.toContain(dictionaries.en["contact.wantsDigest"]);
    // The confirm step's own copy — proof this rendered "confirm", not "form"
    // with the fields simply missing.
    expect(html).toContain("known@example.test");
    expect(html).toContain('type="submit"');
  });
});
