import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ContactForm from "@/components/ContactForm";
import { GuestForm } from "@/components/ContactsAdmin";
import { dictionaryFor } from "@/lib/locales";

/**
 * B360 — the postal-address block asked for a home address, and offered a
 * postcard, on a server with no postcard provider configured. This ticket's
 * own worked example is `InviteRedeem` (see `test/invite-redeem-address.test.tsx`),
 * and the same block is drawn by the guestbook (`ContactForm`), gated the
 * same way here.
 *
 * B383 split the owner's own "Add a guest" form (`ContactsAdmin`'s
 * `GuestForm`) off from that gate: `app/api/contacts/admin/route.ts` stores
 * an address whether or not a postcard was ever asked for — this is the
 * owner's own address book, not a postcard order form — so only its consent
 * checkbox stays behind `postcardsEnabled`, and the address fieldset stays
 * up. See `test/contact-address-fieldset.test.tsx` for that behaviour in
 * full; the case below only confirms the checkbox is still gated.
 */

const en = dictionaryFor("en");

describe("the guestbook's postal block (ContactForm)", () => {
  function render(postcardsEnabled: boolean) {
    return renderToStaticMarkup(
      <ContactForm
        username="ana"
        journalTitle="Ana's journal"
        initialLocale="en"
        locales={["en"]}
        dictionaries={{ en }}
        inviteToken="tok"
        postcardsEnabled={postcardsEnabled}
      />,
    );
  }

  test("is omitted when postcards is off", () => {
    const html = render(false);
    expect(html).not.toContain('id="addr-line1"');
    expect(html).not.toContain(en["contact.wantsPostcard"]);
    // The rest of the form is unaffected.
    expect(html).toContain('id="contact-tel"');
    expect(html).toContain(en["contact.wantsDigest"]);
  });

  test("is offered when postcards is on", () => {
    const html = render(true);
    expect(html).toContain('id="addr-line1"');
    expect(html).toContain(en["contact.wantsPostcard"]);
  });
});

describe("the owner's add-a-guest form's postal block (ContactsAdmin's GuestForm)", () => {
  function render(postcardsEnabled: boolean) {
    return renderToStaticMarkup(
      <GuestForm
        contact={null}
        fallbackLocale="en"
        locales={["en"]}
        username="ana"
        t={(key) => en[key] ?? key}
        busy={false}
        act={async () => null}
        onClose={() => {}}
        postcardsEnabled={postcardsEnabled}
      />,
    );
  }

  test("the address fieldset stays, only the consent checkbox is omitted, when postcards is off", () => {
    const html = render(false);
    expect(html).toContain('id="guest-addr-line1"');
    expect(html).not.toContain(en["contact.adminWantsPostcard"]);
    expect(html).toContain('id="guest-tel"');
  });

  test("is offered when postcards is on", () => {
    const html = render(true);
    expect(html).toContain('id="guest-addr-line1"');
    expect(html).toContain(en["contact.adminWantsPostcard"]);
  });
});
