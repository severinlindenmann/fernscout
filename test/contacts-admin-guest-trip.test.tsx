import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ContactsAdmin from "@/components/ContactsAdmin";
import { dictionaryFor } from "@/lib/locales";

/**
 * The owner's half of B300.
 *
 * Approving somebody opens every `guest` trip in the journal, and nothing
 * else (AGENTS.md, B41) — so a journal whose trips are all `private` or
 * `public` can still approve a contact, and the approval opens nothing at
 * all. The owner used to learn that only from a family member reporting a
 * dead end; this is the page saying so first, before anybody has been
 * approved into nothing.
 */

function render(hasGuestTrip: boolean): string {
  return renderToStaticMarkup(
    <ContactsAdmin
      username="alex"
      locale="en"
      locales={["en"]}
      dictionary={dictionaryFor("en")}
      contacts={[]}
      invites={[]}
      hasGuestTrip={hasGuestTrip}
    />,
  );
}

/** React escapes the apostrophe in "trip's" to `&#x27;` on the way to markup,
 * so the needle has to match rendered HTML rather than the raw dictionary
 * string. */
function escaped(s: string): string {
  return s.replace(/'/g, "&#x27;");
}

describe("the warning that approving opens nothing", () => {
  test("says so when no trip is visibility: guest", () => {
    const html = render(false);
    expect(html).toContain(escaped(dictionaryFor("en")["contact.adminNoGuestTrip"]));
    // Names the one word that changes it.
    expect(html).toMatch(/guest/);
  });

  test("is absent once a trip is open to guests", () => {
    const html = render(true);
    expect(html).not.toContain(escaped(dictionaryFor("en")["contact.adminNoGuestTrip"]));
  });

  /** It has to precede the approve button in the document, not merely exist
   * on the page — "before the owner approves anybody" is an order, not just
   * a presence. There is no pending contact in this fixture to render an
   * approve button for, so this checks it against the control that opens the
   * form which creates one, which sits in the same position. */
  test("appears before the control that leads to approving anybody", () => {
    const html = render(false);
    const warningAt = html.indexOf(escaped(dictionaryFor("en")["contact.adminNoGuestTrip"]));
    const addGuestAt = html.indexOf(dictionaryFor("en")["contact.adminAddGuest"]);
    expect(warningAt).toBeGreaterThan(-1);
    expect(addGuestAt).toBeGreaterThan(-1);
    expect(warningAt).toBeLessThan(addGuestAt);
  });
});
