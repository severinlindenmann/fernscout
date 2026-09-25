import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { GuestForm } from "@/components/studio/readers/GuestForm";
import { telHintKey } from "@/lib/i18n";
import { dictionaryFor } from "@/lib/locales";

/**
 * B376 — the phone field's hint promised postcards (and WhatsApp) regardless
 * of whether this server can act on either, which on a server with postcards
 * off left the one surviving mention of postcards directly under the block
 * B360 had just hidden for exactly that reason. The hint now names only the
 * capabilities actually on, falling back to B303's "kept on file" wording
 * when neither is.
 */

const en = dictionaryFor("en");

describe("telHintKey", () => {
  test("names both when both capabilities are on", () => {
    expect(telHintKey("reader", true, true)).toBe("contact.telHint");
    expect(telHintKey("admin", true, true)).toBe("contact.adminTelHint");
  });

  test("names only postcards when WhatsApp is off", () => {
    expect(telHintKey("reader", true, false)).toBe("contact.telHintPostcardsOnly");
    expect(telHintKey("admin", true, false)).toBe("contact.adminTelHintPostcardsOnly");
  });

  test("names only WhatsApp when postcards is off", () => {
    expect(telHintKey("reader", false, true)).toBe("contact.telHintWhatsappOnly");
    expect(telHintKey("admin", false, true)).toBe("contact.adminTelHintWhatsappOnly");
  });

  test("falls back to B303's wording when neither is on", () => {
    expect(telHintKey("reader", false, false)).toBe("contact.telHintNone");
    expect(telHintKey("admin", false, false)).toBe("contact.adminTelHintNone");
  });
});

describe("the phone hint on the owner's add-a-guest form (GuestForm)", () => {
  function render(postcardsEnabled: boolean, whatsappEnabled: boolean) {
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
        whatsappEnabled={whatsappEnabled}
      />,
    );
  }

  test("the phone hint does not mention postcards with postcards off", () => {
    const html = render(false, true);
    expect(html).toContain(en["contact.adminTelHintWhatsappOnly"]);
    // B383: the address fieldset's own hint legitimately still says
    // "postcard" here — it explains that the address is kept regardless —
    // so this checks the *phone* hint specifically, not the whole page.
    expect(html).not.toContain(en["contact.adminTelHint"]);
    expect(html).not.toContain(en["contact.adminTelHintPostcardsOnly"]);
  });
});
