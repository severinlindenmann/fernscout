import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ContactManage from "@/components/ContactManage";
import { dictionaryFor } from "@/lib/locales";

/**
 * B619 — the two buttons at the foot of the details form are not the owner's.
 *
 * Both say something that is false to exactly one reader. "Stop all emails"
 * cannot stop the day letter: `recipientsFor` in `lib/digest/dayLetter.ts`
 * sends the owner their own copy whatever the row says, because it is their
 * record that it went. "Delete me completely" offers to remove "your name,
 * your address and your access", and the owner's access is `owner.email` in
 * `config.json` — it would take the address and change nothing else.
 *
 * The same shape as B320, which found the paragraph above them saying "the
 * journal is written by an agent" to somebody who writes it.
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

function render(isOwner: boolean): string {
  return renderToStaticMarkup(
    <ContactManage
      username="ana"
      token="tok"
      locales={["en"]}
      dictionary={en}
      contact={CONTACT}
      isOwner={isOwner}
    />,
  );
}

describe("the foot of the details form", () => {
  test("a guest is offered both, as they always have been", () => {
    const html = render(false);
    expect(html).toContain(en["contact.unsubscribe"]);
    expect(html).toContain(en["contact.deleteMe"]);
  });

  test("the owner is offered neither, and the form above is untouched", () => {
    const html = render(true);
    expect(html).not.toContain(en["contact.unsubscribe"]);
    expect(html).not.toContain(en["contact.deleteMe"]);
    // Absent, not disabled — and everything they came for still there.
    expect(html).toContain('id="manage-tel"');
    expect(html).toContain(en["contact.save"]);
  });
});
