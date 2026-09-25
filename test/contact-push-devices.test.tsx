import { describe, expect, test, vi } from "vitest";

// B2291 — the page re-reads itself with router.refresh(); nothing here navigates.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
import { renderToStaticMarkup } from "react-dom/server";
import ContactsAdmin from "@/components/studio/readers/ReadersAdmin";
import type { AdminContact } from "@/components/studio/readers/shared";
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
    relationship: { owner: false, guest: false, buddyOf: [] },
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

  /** B2291: a card is one line now; nothing subscribed is simply not said,
   * like a channel nobody asked for. */
  test("nobody subscribed says nothing about devices", () => {
    expect(render(contact({ pushDevices: 0 }))).not.toContain("device");
  });

  test("a journal with push off says nothing about notifications at all", () => {
    const html = render(contact({ pushDevices: null }));
    expect(html).not.toContain("device");
  });
});

/**
 * The channels a reader asked for, named in a word each (B453), not in the
 * tick box's consent sentence.
 */
describe("the channels a reader is on", () => {
  test("are named in two words, not in the tick box's sentence", () => {
    const html = render(contact({ wantsEmailDigest: true, wantsWhatsapp: true }));
    expect(html).toContain("hears by Email, WhatsApp");
    expect(html).not.toContain("Wants an email when there are new days to read");
  });

  test("a channel nobody asked for is absent, not greyed out", () => {
    const html = render(contact({ wantsEmailDigest: true, wantsPostcard: false }));
    expect(html).not.toContain("Postcard");
  });
});
