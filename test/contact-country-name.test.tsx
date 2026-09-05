import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ContactsAdmin, { type AdminContact } from "@/components/ContactsAdmin";
import { dictionaryFor } from "@/lib/locales";

/**
 * B402 — B398 turned `PostalAddress.country` into an ISO2 code, and the
 * admin's own read-only row (`ContactRow` in `components/ContactsAdmin.tsx`)
 * kept printing it verbatim: a freshly-saved contact read "…, CH" instead of
 * "…, Switzerland" in the one place a person has to copy it onto an
 * envelope by hand.
 */

function contact(country: string): AdminContact {
  return {
    id: "c1",
    name: "Oma",
    email: "oma@example.test",
    locale: "en",
    status: "active",
    wantsEmailDigest: true,
    wantsPostcard: true,
    wantsWhatsapp: false,
    postalAddress: {
      name: "Oma",
      line1: "Bahnhofstrasse 12",
      line2: "",
      postcode: "8001",
      city: "Zürich",
      country,
      tel: "",
    },
    pushDevices: null,
    createdVia: null,
    createdAt: new Date().toISOString(),
    confirmedAt: new Date().toISOString(),
    lastSeenAt: null,
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

describe("the address on the admin's own contact row", () => {
  test("a stored ISO2 code prints its name, not the bare code", () => {
    const html = render(contact("CH"));
    expect(html).toContain("Switzerland");
    expect(html).not.toMatch(/,\s*CH\s*</);
  });

  test("a legacy string resolveCountry cannot place prints exactly as stored", () => {
    const html = render(contact("Elbonia"));
    expect(html).toContain("Elbonia");
  });
});
