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

  function render(knownEmail: string | null, invitedEmail: string | null = null) {
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
        invitedEmail={invitedEmail}
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
  test("the digest box starts ticked; the postcard and WhatsApp boxes do not", () => {
    const html = render(null);
    const boxes = [...html.matchAll(/<input type="checkbox"[^>]*>/g)].map((m) => m[0]);
    expect(boxes).toHaveLength(3);
    expect(boxes[0]).toContain("checked");
    expect(boxes[1]).not.toContain("checked");
    // B365. Unticked by default is not cosmetic: a pre-ticked box is not
    // consent to be messaged on WhatsApp, and Meta's policy — plus the fact
    // that the number was collected for postcards — makes this the one box
    // that must never start on.
    expect(boxes[2]).not.toContain("checked");
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

/**
 * B338 — a mailed invite prefills the address it was sent to; a link the
 * owner copied by hand prefills nothing, exactly as before this ticket. The
 * explanation of what changing the address costs is shown in the one case
 * and not the other, because it is only true in the one case.
 */
describe("the email field prefills only from a mailed invite (B338)", () => {
  const dictionaries = { en: dictionaryFor("en") };

  function render(invitedEmail: string | null) {
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
        knownEmail={null}
        initialName=""
        invitedEmail={invitedEmail}
        alreadyIn={false}
      />,
    );
  }

  test("a mailed invite prefills its address, and says what changing it costs", () => {
    const html = render("oma@example.test");
    expect(html).toContain('id="invite-email"');
    expect(html).toContain('value="oma@example.test"');
    // The apostrophe renders HTML-escaped, so this checks the part either
    // side of it rather than the raw dictionary string.
    expect(html).toContain("This invitation was sent to oma@example.test");
    expect(html).toContain("wait in the queue instead of skipping it");
  });

  test("a hand-copied link prefills nothing, and says nothing about changing it", () => {
    const html = render(null);
    const field = /<input id="invite-email"[^>]*>/.exec(html)?.[0] ?? "";
    expect(field).toContain('value=""');
    expect(html).not.toContain(dictionaries.en["invite.emailPrefilledHint"].split("{email}")[0]);
  });
});
