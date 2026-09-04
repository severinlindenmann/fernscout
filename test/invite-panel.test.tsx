import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ContactsAdmin, { type AdminInvite } from "@/components/ContactsAdmin";
import { dictionaryFor } from "@/lib/locales";

/**
 * The panel that issues links — B281.
 *
 * What was wrong was not that the rows said too little. `InviteRow` has
 * rendered the note, the language and the kind since B97, and the screenshot
 * that prompted this task showed none of them because **the form that
 * collected a note made the wrong kind of link**: this panel could only make
 * a `personal` link, and the two kinds an owner actually hands out — reading
 * and writing — were made on `/{user}/me` by a component that asked for
 * neither a note nor a language. So every real link had null in both columns
 * and the list was one row repeated.
 *
 * Hence these assertions: the panel offers both kinds and not `personal`, the
 * note is asked for, a writing link cannot be requested without a trip to
 * name, and a row with a recoverable link can be copied while a dead one
 * cannot. The copy control is the one that matters most to get absent rather
 * than disabled — a button that hands over a URL which refuses the recipient
 * reads as the journal being broken.
 */

const future = new Date(Date.now() + 30 * 86_400_000).toISOString();
const past = new Date(Date.now() - 86_400_000).toISOString();

function invite(over: Partial<AdminInvite>): AdminInvite {
  return {
    id: "inv-1",
    kind: "guest",
    tripId: null,
    name: null,
    locale: null,
    createdAt: new Date().toISOString(),
    expiresAt: future,
    revokedAt: null,
    uses: 0,
    url: null,
    ...over,
  };
}

function render(
  invites: AdminInvite[] = [],
  trips: { id: string; title: string }[] = [{ id: "asia-2026", title: "Asia" }],
): string {
  return renderToStaticMarkup(
    <ContactsAdmin
      username="alex"
      locale="en"
      locales={["en"]}
      dictionary={dictionaryFor("en")}
      contacts={[]}
      invites={invites}
      trips={trips}
      // Not what this file is testing — B300 is `test/contacts-admin-guest-trip.test.tsx`.
      // True keeps the new warning banner out of these assertions.
      hasGuestTrip={true}
    />,
  );
}

const dict = dictionaryFor("en");

describe("the form that makes a link", () => {
  test("offers the two kinds an owner hands out", () => {
    const html = render();
    expect(html).toContain(dict["me.inviteGuestTitle"]);
    expect(html).toContain(dict["me.inviteBuddyTitle"]);
    // And says what each one leads to, beside the control rather than in a
    // tooltip: one belongs in a family group chat and one does not.
    expect(html).toContain(dict["me.inviteGuestBody"]);
  });

  test("no longer offers a personal link", () => {
    const html = render();
    expect(html).not.toContain(dict["contact.adminInvitePersonalTitle"]);
    expect(html).toContain(dict["contact.adminNewInvite"]);
    expect(dict["contact.adminNewInvite"]).not.toContain("personal");
  });

  test("asks what the link is for, not who it is for", () => {
    const html = render();
    expect(html).toContain(dict["contact.adminInviteNote"]);
    expect(html).not.toContain(dict["contact.adminInviteFor"]);
  });

  test("defaults to the reading link, never the writing one", () => {
    const html = render();
    // The checked radio is the guest one — write access must not be one
    // un-read radio button away.
    const guestFirst = html.indexOf('value="guest"');
    const buddyFirst = html.indexOf('value="buddy"');
    expect(guestFirst).toBeGreaterThan(-1);
    expect(guestFirst).toBeLessThan(buddyFirst);
    expect(html.slice(guestFirst - 200, guestFirst + 200)).toContain("checked");
  });

  test("a journal with no trip says so on the option, and cannot pick it", () => {
    const html = render([], []);
    expect(html).toContain(dict["contact.adminInviteNoTrips"]);
    // Said before the choice rather than after it, and the radio is refused
    // rather than left selectable — the dead-button shape this codebase's
    // capability rule exists to avoid.
    const buddyAt = html.indexOf('value="buddy"');
    expect(html.slice(buddyAt - 200, buddyAt + 200)).toContain("disabled");
    expect(html).not.toContain(dict["contact.adminInviteWhichTrip"]);
    // And the writing link's usual description is not shown, because it is
    // describing something this journal cannot do yet.
    expect(html).not.toContain(dict["me.inviteBuddyBody"]);
  });

  test("with a trip, the writing option is offered normally", () => {
    const html = render();
    const buddyAt = html.indexOf('value="buddy"');
    expect(html.slice(buddyAt - 200, buddyAt + 200)).not.toContain("disabled");
    expect(html).toContain(dict["me.inviteBuddyBody"]);
    expect(html).not.toContain(dict["contact.adminInviteNoTrips"]);
  });
});

describe("copying a link that was already sent", () => {
  test("a live link with a recoverable token offers the copy control", () => {
    const html = render([invite({ url: "https://example.test/alex/invite/guest/tok", name: "Family" })]);
    expect(html).toContain(dict["contact.adminCopyLink"]);
    expect(html).toContain("Family");
  });

  test("a link from before B280 has nothing to copy, and no control", () => {
    const html = render([invite({ url: null })]);
    expect(html).not.toContain(dict["contact.adminCopyLink"]);
    // Revoke is still there — the link works, it just cannot be shown again.
    expect(html).toContain(dict["contact.adminRevokeLink"]);
  });

  test("a revoked link offers neither copy nor revoke", () => {
    const html = render([invite({ revokedAt: new Date().toISOString(), url: "https://x/y" })]);
    expect(html).not.toContain(dict["contact.adminCopyLink"]);
    expect(html).not.toContain(dict["contact.adminRevokeLink"]);
    expect(html).toContain(dict["contact.adminInviteRevoked"]);
  });

  test("an expired link offers neither, and says it is expired", () => {
    const html = render([invite({ expiresAt: past, url: "https://x/y" })]);
    expect(html).not.toContain(dict["contact.adminCopyLink"]);
    expect(html).toContain(dict["contact.adminInviteExpired"]);
  });

  test("the copy control does not recite the URL as its accessible name", () => {
    const url = "https://example.test/alex/invite/guest/secret-token";
    const html = render([invite({ url, name: "Family" })]);
    // B199's rule, and here it is a credential rather than merely unreadable:
    // the name says what it copies, and the token is not in it.
    const labels = [...html.matchAll(/aria-label="([^"]*)"/g)].map((m) => m[1]);
    expect(labels.some((label) => label.includes("secret-token"))).toBe(false);
    expect(labels.some((label) => label.includes("Family"))).toBe(true);
  });

  /**
   * B358 — an invite with no note used to fill the missing half with an
   * em-dash placeholder, so the name ended "— —" and a screen reader
   * announced the separator with nothing after it.
   */
  test("an unlabelled link's accessible name has no dangling separator", () => {
    const html = render([invite({ url: "https://example.test/alex/invite/guest/tok", name: null })]);
    const labels = [...html.matchAll(/aria-label="([^"]*)"/g)].map((m) => m[1]);
    const copyLabel = labels.find((label) => label.includes(dict["me.inviteGuestTitle"]));
    expect(copyLabel).toBeTruthy();
    expect(copyLabel).not.toMatch(/—\s*—/);
    expect(copyLabel).not.toMatch(/[—-]\s*$/);
  });
});

describe("a link written before this task", () => {
  test("still renders with a label rather than a blank", () => {
    const html = render([invite({ kind: "personal", name: "Oma" })]);
    expect(html).toContain(dict["contact.adminInvitePersonalTitle"]);
    expect(html).toContain("Oma");
  });
});
