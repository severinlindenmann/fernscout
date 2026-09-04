import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ContactsAdmin, { type AdminInvite } from "@/components/ContactsAdmin";
import { dictionaryFor } from "@/lib/locales";

/**
 * What the guest list says about the links the owner has handed out — B97.
 *
 * The list is the only place a link can be revoked, and the two kinds B33
 * added lead to different things: a guest link leads to *reading* the
 * journal's `guest` trips, a buddy link leads to *write access* to one named
 * trip. Issued from the access panel — which is how they are normally issued —
 * neither carries a name or a language, so both used to render as `— · — ·
 * used 0 times`: two identical rows, one of which leads to somebody writing to
 * a trip.
 *
 * So the assertions are on the *copy*, as B79's are, because the mistake this
 * can produce is not a broken button. It is an owner who meant to kill the
 * writing link, could not tell which row it was, and killed the reading link
 * instead — and a link cannot be shown again, so the guess is not one they can
 * take back.
 */

const day = 86_400_000;
const future = new Date(Date.now() + 30 * day).toISOString();
const past = new Date(Date.now() - day).toISOString();

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
    // Null by default, which is a row whose token predates B280 — the copy
    // control is then absent. The tests here are about the *copy* on the rows,
    // so a link that could also be copied would add a control to every
    // assertion without changing what any of them is checking.
    url: null,
    ...over,
  };
}

function render(invites: AdminInvite[]): string {
  return renderToStaticMarkup(
    <ContactsAdmin
      username="alex"
      locale="en"
      locales={["en"]}
      dictionary={dictionaryFor("en")}
      contacts={[]}
      invites={invites}
    />,
  );
}

/** The three shapes a journal can be holding at once, exactly as the access
 * panel issues them: the two B33 kinds carrying no name and no language, and
 * the personal link this page issues itself. */
const THREE: AdminInvite[] = [
  invite({ id: "a", kind: "personal", name: "Oma", locale: "en", expiresAt: null }),
  invite({ id: "b", kind: "guest" }),
  invite({ id: "c", kind: "buddy", tripId: "bus-2026" }),
];

describe("the list of issued links", () => {
  test("says which kind each one is, in the words the access panel used", () => {
    const html = render(THREE);
    expect(html).toContain("A link for someone to read");
    expect(html).toContain("A link for someone to write");
    expect(html).toContain("A personal link, for one person");
  });

  test("three rows nobody has to open anything to tell apart", () => {
    const html = render(THREE);
    // The row that used to be the whole line, and used to be identical for the
    // two kinds that matter.
    expect(html).not.toContain("— · — ·");
    const rows = html.split("<li").length - 1;
    expect(rows).toBe(3);
  });

  test("the writing link names its trip", () => {
    const html = render(THREE);
    expect(html).toContain("the trip bus-2026");
    // And only that row: a guest link is journal-wide and has no trip to name.
    expect(html.split("the trip bus-2026")).toHaveLength(2);
  });

  test("says when a link stops working, or that it has no end date", () => {
    const html = render(THREE);
    expect(html).toContain(`works until ${future.slice(0, 10)}`);
    expect(html).toContain("no end date");
  });

  test("a live link can be revoked", () => {
    const html = render([invite({ id: "b", kind: "guest" })]);
    expect(html).toContain("Revoke");
  });

  test("an expired one says so, and offers no button", () => {
    const html = render([invite({ id: "b", kind: "guest", expiresAt: past })]);
    expect(html).toContain("expired");
    expect(html).not.toContain("Revoke");
  });

  test("a revoked one says so, and offers no button", () => {
    const html = render([invite({ id: "b", kind: "guest", revokedAt: past })]);
    expect(html).toContain("revoked");
    expect(html).not.toContain("Revoke");
  });

  test("still counts how often each has been used", () => {
    const html = render([invite({ id: "b", kind: "guest", uses: 3 })]);
    expect(html).toContain("used 3×");
  });
});

