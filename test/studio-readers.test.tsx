import { describe, expect, test, vi } from "vitest";

// B2291 — the page re-reads itself with router.refresh(); nothing here navigates.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
import { renderToStaticMarkup } from "react-dom/server";
import ContactsAdmin from "@/components/studio/readers/ReadersAdmin";
import type { AdminContact } from "@/components/studio/readers/shared";
import { dictionaryFor } from "@/lib/locales";

/**
 * B2092 — the readers page inside the studio. Pins what the move changed on
 * the page itself: "Waiting for you" was shown over rows where the contact,
 * not the owner, owed the next step, so the pending list splits by whose
 * turn it is; and no stored code (`owner-import`, `owner-grant`, a status
 * label over a dash) reaches the screen as if it were a sentence.
 */
const dict = dictionaryFor("en");
const now = new Date().toISOString();

function contact(over: Partial<AdminContact>): AdminContact {
  return {
    id: "c",
    name: "Somebody",
    email: "somebody@example.test",
    locale: "en",
    status: "pending",
    wantsEmailDigest: false,
    wantsPostcard: false,
    wantsWhatsapp: false,
    postalAddress: null,
    pushDevices: 0,
    createdVia: null,
    createdAt: now,
    confirmedAt: null,
    lastSeenAt: null,
    relationship: { owner: false, guest: false, buddyOf: [] },
    ...over,
  };
}

const rows = [
  contact({ id: "asks", name: "Asks Anna", confirmedAt: now, createdVia: "asked" }),
  contact({ id: "owes", name: "Owes Otto", createdVia: "owner-import" }),
  contact({ id: "in", name: "In Ida", status: "active", confirmedAt: now, createdVia: "owner-grant" }),
];

function render(): string {
  return renderToStaticMarkup(
    <ContactsAdmin
      username="alex"
      locale="en"
      locales={["en"]}
      dictionary={dictionaryFor("en")}
      contacts={rows}
      invites={[]}
      hasGuestTrip={true}
      pushEnabled
    />,
  );
}

/** The section a row's name sits in, by the nearest h2 before it. */
function headingOver(html: string, name: string): string {
  const before = html.slice(0, html.indexOf(name));
  const all = [...before.matchAll(/<h2[^>]*>([^<]*)/g)];
  return all.at(-1)?.[1] ?? "";
}

describe("the two waiting groups split by whose turn it is", () => {
  test("a confirmed request is waiting for the owner's answer, with Let in", () => {
    const html = render();
    expect(headingOver(html, "Asks Anna")).toBe(dict["contact.adminPending"]);
    const card = html.slice(html.indexOf("Asks Anna"), html.indexOf("Owes Otto"));
    expect(card).toContain(dict["readers.letIn"].replace("{name}", "Asks"));
  });

  // B2296: `createdVia: "owner-import"` and never confirmed is `notInvited`
  // now, its own group — "Owes Otto" was never sent anything to owe a step
  // on, unlike a row invited (any other `createdVia`) and still unconfirmed.
  test("an imported, unconfirmed row is not invited yet, with no Approve", () => {
    const html = render();
    expect(headingOver(html, "Owes Otto")).toBe(dict["contact.adminNotInvited"]);
    const start = html.indexOf("Owes Otto");
    const card = html.slice(start, html.indexOf("</li>", start));
    expect(card).not.toContain(dict["readers.letIn"].replace("{name}", "Owes"));
    expect(card).toContain(dict["readers.invite"].replace("{name}", "Owes"));
  });

  test("a link's request that never proved anything is invited, not waiting on the owner", () => {
    const html = renderToStaticMarkup(
      <ContactsAdmin
        username="alex"
        locale="en"
        locales={["en"]}
        dictionary={dictionaryFor("en")}
        contacts={[contact({ id: "asked", name: "Asked Alma", createdVia: "asked" })]}
        invites={[]}
        hasGuestTrip={true}
        pushEnabled
      />,
    );
    expect(headingOver(html, "Asked Alma")).toBe(dict["readers.group.invited"]);
    const start = html.indexOf("Asked Alma");
    const card = html.slice(start, html.indexOf("</li>", start));
    expect(card).not.toContain(dict["readers.letIn"].replace("{name}", "Asked"));
    // Nothing to send again: it was their request, not the owner's invitation.
    expect(card).not.toContain(dict["readers.sendAgain"]);
  });

  test("the headings say whose turn it is", () => {
    expect(dict["contact.adminPending"]).toBe("Waiting for your answer");
    expect(dict["readers.group.invited"]).toBe("Invited — not opened yet");
  });
});

describe("no stored code reaches the screen", () => {
  test.each(["owner-import", "owner-grant", "self:traveller", "asked"])("%s is never printed", (code) => {
    expect(render()).not.toContain(`>${code}<`);
  });

  test("provenance and state are sentences", () => {
    const html = render();
    expect(html).toContain(dict["contact.adminViaImport"]);
    expect(html).toContain(dict["contact.adminViaGrant"]);
    expect(html).not.toContain(dict["contact.statusPending"]);
    expect(html).not.toContain(">—<");
  });

  test("an unknown code falls back to nothing rather than itself", () => {
    const html = renderToStaticMarkup(
      <ContactsAdmin
        username="alex"
        locale="en"
        locales={["en"]}
        dictionary={dict}
        contacts={[contact({ createdVia: "some-future-code" })]}
        invites={[]}
        hasGuestTrip={true}
      />,
    );
    expect(html).not.toContain("some-future-code");
  });
});
