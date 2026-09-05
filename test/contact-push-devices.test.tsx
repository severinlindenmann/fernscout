import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ContactsAdmin, { type AdminContact } from "@/components/ContactsAdmin";
import { dictionaryFor } from "@/lib/locales";

/**
 * B453 — the fourth channel, on the owner's own list.
 *
 * Push has carried a `contactId` since W12 and `subscribersFor` has used it to
 * keep a closed trip's notification off the wrong lock screen, but none of it
 * reached the page where the owner looks at a person: a card said "wants an
 * email" and nothing at all about the phone in their hand.
 *
 * The distinction these tests exist to hold is `null` against `0`. Zero is a
 * fact — nobody has subscribed — and belongs on the card. `null` is this
 * journal having push switched off, where a line about notifications is
 * describing a channel that does not exist here.
 */

function contact(over: Partial<AdminContact> = {}): AdminContact {
  return {
    id: "c-1",
    name: "Oma",
    email: "oma@example.test",
    locale: "en",
    status: "active",
    wantsEmailDigest: true,
    wantsPostcard: false,
    wantsWhatsapp: false,
    postalAddress: null,
    pushDevices: null,
    createdVia: null,
    createdAt: new Date().toISOString(),
    confirmedAt: new Date().toISOString(),
    lastSeenAt: null,
    ...over,
  };
}

function render(c: AdminContact): string {
  return renderToStaticMarkup(
    <ContactsAdmin
      username="alex"
      locale="en"
      locales={["en"]}
      dictionary={dictionaryFor("en")}
      contacts={[c]}
      invites={[]}
      hasGuestTrip={true}
    />,
  );
}

describe("what the owner is told about notifications", () => {
  test("two subscribed devices are counted", () => {
    expect(render(contact({ pushDevices: 2 }))).toContain("on 2 devices");
  });

  /** The `.one` string, so nobody reads "on 1 devices". */
  test("one device is not a plural", () => {
    const html = render(contact({ pushDevices: 1 }));
    expect(html).toContain("on one device");
    expect(html).not.toContain("on 1 devices");
  });

  /** The useful half of the answer: an owner asking "why doesn't she get
   * anything on her phone" is told that nothing is subscribed. */
  test("nobody subscribed says so rather than going quiet", () => {
    expect(render(contact({ pushDevices: 0 }))).toContain("on no device yet");
  });

  test("a journal with push off says nothing about notifications at all", () => {
    const html = render(contact({ pushDevices: null }));
    expect(html).not.toContain("Notifications on a phone");
  });
});

/**
 * The channels a reader asked for, and the sentence they used to be.
 *
 * Three whole sentences joined by a dot made the most scannable fact on the
 * card — how this person hears from the journal — the least scannable thing on
 * it. The consent sentences still exist; they belong to the tick boxes, where
 * each one is being agreed to rather than skimmed.
 */
describe("the channels a reader is on", () => {
  test("are named in two words, not in the tick box's sentence", () => {
    const html = render(contact({ wantsEmailDigest: true, wantsWhatsapp: true }));
    expect(html).toContain(">Email<");
    expect(html).toContain(">WhatsApp<");
    expect(html).not.toContain("Wants an email when there are new days to read");
  });

  test("a channel nobody asked for is absent, not greyed out", () => {
    const html = render(contact({ wantsEmailDigest: true, wantsPostcard: false }));
    expect(html).not.toContain(">Postcard<");
  });
});
