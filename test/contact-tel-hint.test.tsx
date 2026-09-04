import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ContactForm from "@/components/ContactForm";
import ContactManage from "@/components/ContactManage";
import { GuestForm } from "@/components/ContactsAdmin";
import { dictionaryFor } from "@/lib/locales";

/**
 * B303 — the phone number field existed in three places before B273 gave the
 * guest invite form's copy of it a reason ("kept on file for the owner —
 * nothing on this site sends to it yet"): the guestbook (`ContactForm`), the
 * reader's own manage page (`ContactManage`), and the owner's add/edit form
 * (`ContactsAdmin`'s `GuestForm`). All three rendered `(optional)` and
 * nothing underneath, which is the exact gap B273 closed on the invite form
 * alone.
 *
 * The owner's form is talking about somebody else, not itself, so it gets
 * its own key — `contact.adminTelHint` — the same split `adminAddressHint`
 * already has for the address fieldset.
 */

const en = dictionaryFor("en");

describe("the phone field says what it is for, everywhere it is asked", () => {
  test("the guestbook (ContactForm)", () => {
    const html = renderToStaticMarkup(
      <ContactForm
        username="ana"
        journalTitle="Ana's journal"
        initialLocale="en"
        locales={["en"]}
        dictionaries={{ en }}
        inviteToken="tok"
      />,
    );
    expect(html).toContain('id="contact-tel"');
    expect(html).toContain(en["contact.telHint"]);
  });

  test("the reader's own manage page (ContactManage)", () => {
    const html = renderToStaticMarkup(
      <ContactManage
        username="ana"
        token="tok"
        locales={["en"]}
        dictionary={en}
        contact={{
          name: "Jo",
          email: "jo@example.test",
          locale: "en",
          status: "active",
          wantsEmailDigest: true,
          wantsPostcard: false,
      wantsWhatsapp: false,
          address: {
            name: "",
            line1: "",
            line2: "",
            postcode: "",
            city: "",
            country: "",
            tel: "",
          },
        }}
      />,
    );
    expect(html).toContain('id="manage-tel"');
    expect(html).toContain(en["contact.telHint"]);
  });

  test("the owner adding or editing a guest by hand (ContactsAdmin's GuestForm) — its own wording", () => {
    const html = renderToStaticMarkup(
      <GuestForm
        contact={null}
        fallbackLocale="en"
        locales={["en"]}
        t={(key) => en[key] ?? key}
        busy={false}
        act={async () => null}
        onClose={() => {}}
      />,
    );
    expect(html).toContain('id="guest-tel"');
    expect(html).toContain(en["contact.adminTelHint"]);
    // Reuses telHint's own wording nowhere near as literally as it first
    // looks: the two keys carry different strings, and this proves the
    // owner-facing one is the one actually rendered here, not a fallback.
    expect(en["contact.adminTelHint"]).not.toBe(en["contact.telHint"]);
  });
});
