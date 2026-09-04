import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ContactsAdmin, {
  type AdminContact,
  type AdminInvite,
} from "@/components/ContactsAdmin";
import { dictionaryFor } from "@/lib/locales";

/**
 * "Came via", answered in words — B321.
 *
 * The row rendered `contact.createdVia` verbatim, and that column is
 * provenance the database keeps for the code: `invite:<id>` | `open` |
 * `owner`. So the owner's answer to how somebody got here was
 * `invite:1529b564-abd1-4f47-8735-17675e660b7c` — and the same UUID for
 * everybody who used one link, so three people from one family link read as
 * three unrelated strings.
 *
 * The fact being withheld is the one that matters most on this page: whether a
 * row is somebody who reads the journal or somebody who may write days into a
 * named trip. The invite record has it, and the invite list beside it has been
 * showing it since B97; the contact rows were the surface that never got it.
 *
 * Asserted on the words rather than on a lookup, because the failure is a
 * sentence the owner reads before deciding whether to revoke somebody.
 */

const dict = dictionaryFor("en");

const trips = [
  { id: "asien-2025", title: "Asia 2025" },
  { id: "alps-2024", title: "The Alps" },
];

function contact(over: Partial<AdminContact>): AdminContact {
  return {
    id: "c-1",
    name: "Kevin",
    email: "kevin@example.test",
    locale: "en",
    status: "active",
    wantsEmailDigest: false,
    wantsPostcard: false,
    wantsWhatsapp: false,
    postalAddress: null,
    createdVia: null,
    createdAt: new Date().toISOString(),
    confirmedAt: new Date().toISOString(),
    lastSeenAt: null,
    ...over,
  };
}

function invite(over: Partial<AdminInvite>): AdminInvite {
  return {
    id: "inv-1",
    kind: "guest",
    tripId: null,
    name: null,
    locale: null,
    createdAt: new Date().toISOString(),
    expiresAt: null,
    revokedAt: null,
    uses: 1,
    url: null,
    ...over,
  };
}

function render(contacts: AdminContact[], invites: AdminInvite[] = []): string {
  return renderToStaticMarkup(
    <ContactsAdmin
      username="alex"
      locale="en"
      locales={["en"]}
      dictionary={dict}
      contacts={contacts}
      invites={invites}
      trips={trips}
      hasGuestTrip={true}
    />,
  );
}

describe("how a contact row says somebody arrived", () => {
  test("never prints the raw provenance id", () => {
    const html = render(
      [contact({ createdVia: "invite:inv-1" })],
      [invite({ id: "inv-1", kind: "guest" })],
    );
    expect(html).not.toContain("invite:inv-1");
  });

  /**
   * Asserted as the row's own `<dd>` rather than as a substring of the page:
   * the form above this list offers both kinds by name, so "the words appear
   * somewhere" is true whether or not the row says anything at all.
   */
  test("a guest link says it leads to reading, in the words it was sent with", () => {
    const html = render(
      [contact({ createdVia: "invite:inv-1" })],
      [invite({ id: "inv-1", kind: "guest" })],
    );
    expect(html).toContain(`<dd>${dict["me.inviteGuestTitle"]}</dd>`);
  });

  /**
   * The one that decides whether the owner revokes somebody: a buddy link is
   * write access to a named trip, and the row could not say either half.
   */
  test("a buddy link says it leads to writing, and names the trip", () => {
    const html = render(
      [contact({ createdVia: "invite:inv-2" })],
      [invite({ id: "inv-2", kind: "buddy", tripId: "asien-2025" })],
    );
    expect(html).toContain(dict["me.inviteBuddyTitle"]);
    expect(html).toContain("Asia 2025");
  });

  test("the trip is named as the owner named it, not as the URL spells it", () => {
    const html = render(
      [contact({ createdVia: "invite:inv-2" })],
      [invite({ id: "inv-2", kind: "buddy", tripId: "asien-2025" })],
    );
    // The id survives nowhere on the row — it is what the owner was never
    // shown, having picked the trip from a dropdown of titles.
    expect(html).not.toContain("asien-2025");
  });

  test("a trip with no title left to find falls back to its id rather than to nothing", () => {
    const html = render(
      [contact({ createdVia: "invite:inv-3" })],
      [invite({ id: "inv-3", kind: "buddy", tripId: "gone-2019" })],
    );
    // In the row, beside the kind — not merely somewhere in the markup, which
    // the invite list below would satisfy on its own.
    expect(html).toContain(`<dd>${dict["me.inviteBuddyTitle"]} · the trip gone-2019</dd>`);
  });

  /**
   * `listInvites` returns every row the owner has, revoked and expired
   * included, so this is rare — but a row that reinstated the UUID here would
   * put the whole bug back for exactly the contacts hardest to place.
   */
  test("an invite that is no longer listed still reads as a sentence", () => {
    const html = render([contact({ createdVia: "invite:vanished" })], []);
    expect(html).toContain(dict["contact.adminViaInvite"]);
    expect(html).not.toContain("vanished");
  });

  test("the owner's own row, and a row from the guestbook B37 removed", () => {
    expect(render([contact({ createdVia: "owner" })])).toContain(dict["contact.adminViaOwner"]);
    expect(render([contact({ createdVia: "open" })])).toContain(dict["contact.adminViaOpen"]);
  });

  test("a row with no provenance at all is still a dash, not an empty line", () => {
    const html = render([contact({ createdVia: null })]);
    expect(html).toContain("—");
  });

  /**
   * Two lists on one page naming one trip two different ways is a difference
   * the owner has to decode. The invite list has said `asien-2025` since B97;
   * it says what the contact rows now say.
   */
  test("and the invite list beside it names the same trip the same way", () => {
    const html = render([], [invite({ id: "inv-2", kind: "buddy", tripId: "alps-2024" })]);
    expect(html).toContain("The Alps");
    expect(html).not.toContain("alps-2024");
  });
});
