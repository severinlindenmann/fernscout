import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ContactManage from "@/components/ContactManage";
import { dictionaryFor } from "@/lib/locales";

/**
 * B2356 — the postcard and WhatsApp opt-in checkboxes used to render
 * unconditionally, whatever `isEnabled("postcards"/"whatsapp", user)` said,
 * while the SMS checkbox right next to them was already gated on
 * `smsEnabled`. An optional capability that is off must be absent, not
 * merely inert (AGENTS.md).
 */

const en = dictionaryFor("en");

const CONTACT = {
  name: "Jo",
  email: "jo@example.test",
  locale: "en" as const,
  status: "active" as const,
  wantsEmailDigest: true,
  wantsPostcard: false,
  wantsWhatsapp: false,
  address: { name: "", line1: "", line2: "", postcode: "", city: "", country: "", tel: "" },
};

function render(caps: { postcardsEnabled?: boolean; whatsappEnabled?: boolean }): string {
  return renderToStaticMarkup(
    <ContactManage
      username="ana"
      token="tok"
      locales={["en"]}
      dictionary={en}
      contact={CONTACT}
      {...caps}
    />,
  );
}

describe("ContactManage's opt-in checkboxes follow their capabilities", () => {
  test("both are absent with no capabilities passed (the closed-by-default case)", () => {
    const html = render({});
    expect(html).not.toContain(en["contact.wantsPostcard"]);
    expect(html).not.toContain(en["contact.wantsWhatsapp"]);
    // Everything else on the form is still there.
    expect(html).toContain(en["contact.wantsDigest"]);
  });

  test("postcards on, whatsapp off: only the postcard tick shows", () => {
    const html = render({ postcardsEnabled: true });
    expect(html).toContain(en["contact.wantsPostcard"]);
    expect(html).not.toContain(en["contact.wantsWhatsapp"]);
  });

  test("both on: both show", () => {
    const html = render({ postcardsEnabled: true, whatsappEnabled: true });
    expect(html).toContain(en["contact.wantsPostcard"]);
    expect(html).toContain(en["contact.wantsWhatsapp"]);
  });
});
