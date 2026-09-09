import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ContactForm from "@/components/ContactForm";
import ContactsAdmin, { GuestForm } from "@/components/ContactsAdmin";
import InviteRedeem from "@/components/InviteRedeem";
import { dictionaryFor } from "@/lib/locales";
import type { AdminContact } from "@/components/ContactsAdmin";

/**
 * B378 — the WhatsApp checkbox used to be offered on a journal with the
 * capability switched off, one line under a hint that already said nothing
 * sends there. `postcardsEnabled` already gates its own checkbox on every one
 * of these forms; this is the same gate for `whatsappEnabled`, which existed
 * as a prop everywhere and was previously spent only on the hint's wording.
 */

const en = dictionaryFor("en");
const WHATSAPP_LABEL = en["contact.wantsWhatsapp"];

describe("the WhatsApp checkbox is gated on whatsappEnabled", () => {
  test("InviteRedeem — offered when on, absent when off", () => {
    const props = {
      username: "ana",
      journalTitle: "Ana's journal",
      kind: "guest" as const,
      tripTitle: null,
      token: "tok",
      initialLocale: "en" as const,
      locales: ["en"],
      dictionaries: { en },
      knownEmail: null,
      initialName: "",
      invitedEmail: null,
      alreadyIn: false,
    };
    const on = renderToStaticMarkup(<InviteRedeem {...props} whatsappEnabled={true} />);
    const off = renderToStaticMarkup(<InviteRedeem {...props} whatsappEnabled={false} />);
    expect(on).toContain(WHATSAPP_LABEL);
    expect(off).not.toContain(WHATSAPP_LABEL);
  });

  test("ContactForm — offered when on, absent when off", () => {
    const props = {
      username: "ana",
      journalTitle: "Ana's journal",
      initialLocale: "en" as const,
      locales: ["en"],
      dictionaries: { en },
      inviteToken: "tok",
    };
    const on = renderToStaticMarkup(<ContactForm {...props} whatsappEnabled={true} />);
    const off = renderToStaticMarkup(<ContactForm {...props} whatsappEnabled={false} />);
    expect(on).toContain(WHATSAPP_LABEL);
    expect(off).not.toContain(WHATSAPP_LABEL);
  });

  test("ContactsAdmin's GuestForm — offered when on, absent when off", () => {
    const props = {
      contact: null,
      fallbackLocale: "en" as const,
      locales: ["en"],
      username: "ana",
      t: (key: string) => en[key as keyof typeof en] ?? key,
      busy: false,
      act: async () => null,
      onClose: () => {},
    };
    const on = renderToStaticMarkup(<GuestForm {...props} whatsappEnabled={true} />);
    const off = renderToStaticMarkup(<GuestForm {...props} whatsappEnabled={false} />);
    expect(on).toContain(en["contact.adminWantsWhatsapp"]);
    expect(off).not.toContain(en["contact.adminWantsWhatsapp"]);
  });
});

/**
 * B389 — a stored phone number `toE164` cannot parse (a legacy national
 * number with no configured default country, or an unrecognised `+cc`) reads
 * on the owner's contacts list exactly like a number that works. This is the
 * one place the owner would learn otherwise: `lib/digest/dayWhatsapp.ts`'s
 * send loop just skips it.
 */
describe("an unmessageable phone number says so on the owner's contacts list", () => {
  function contact(tel: string): AdminContact {
    return {
      id: "c1",
      name: "Jo",
      email: "jo@example.test",
      locale: "en",
      status: "active",
      wantsEmailDigest: true,
      wantsPostcard: false,
      wantsWhatsapp: false,
      postalAddress: {
        name: "Jo",
        line1: "",
        line2: "",
        postcode: "",
        city: "",
        country: "",
        tel,
      },
      pushDevices: null,
      createdVia: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      confirmedAt: "2026-01-01T00:00:00.000Z",
      lastSeenAt: null,
      relationship: { owner: false, buddyOf: [], guest: true },
    };
  }

  function render(tel: string, defaultCountryCode?: string): string {
    return renderToStaticMarkup(
      <ContactsAdmin
        username="alex"
        locale="en"
        locales={["en"]}
        dictionary={en}
        contacts={[contact(tel)]}
        invites={[]}
        hasGuestTrip={true}
        defaultCountryCode={defaultCountryCode}
      />,
    );
  }

  test("a national number with no configured default country is flagged", () => {
    const html = render("076 000 00 00");
    expect(html).toContain("076 000 00 00");
    expect(html).toContain(en["contact.telNotMessageable"]);
  });

  test("the same number with a configured default country is not flagged", () => {
    const html = render("076 000 00 00", "41");
    expect(html).not.toContain(en["contact.telNotMessageable"]);
  });

  test("an already-international number is not flagged", () => {
    const html = render("+41 76 000 00 00");
    expect(html).not.toContain(en["contact.telNotMessageable"]);
  });

  test("no tel at all renders no note and no phone row", () => {
    const html = render("");
    expect(html).not.toContain(en["contact.telNotMessageable"]);
    expect(html).not.toContain(en["contact.tel"] + "</dt>");
  });
});
