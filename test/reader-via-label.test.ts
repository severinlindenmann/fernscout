import { describe, expect, test } from "vitest";
import { viaLabel, type AdminInvite } from "@/components/studio/readers/shared";
import { translate, type TranslationKey } from "@/lib/i18n";
import { dictionaryFor } from "@/lib/locales";

/**
 * B2368 — the provenance label for somebody who came in through a link said
 * only what kind of link it was ("A link for someone to read"), ignoring the
 * link's own name ("Family chat") even when the owner had named it. A buddy
 * link's trip already got this treatment (`contact.adminInviteTrip`); a
 * named guest or personal link did not.
 */

const dict = dictionaryFor("en");
const t = (key: TranslationKey, vars?: Record<string, string>) => translate(dict, key, vars);
const fill = (key: string, vars: Record<string, string> = {}) =>
  Object.entries(vars).reduce((text, [k, v]) => text.replaceAll(`{${k}}`, v), dict[key]);

const link: AdminInvite = {
  id: "inv-1",
  kind: "guest",
  tripId: null,
  name: "Family chat",
  locale: null,
  createdAt: "2026-09-20T06:00:00Z",
  expiresAt: "2099-10-25T06:00:00Z",
  revokedAt: null,
  uses: 4,
  url: "http://localhost:3000/alex/invite/guest/fs_inv_x",
  joinUrl: "http://localhost:3000/j/abcdefghjk",
  live: true,
};

describe("viaLabel names the link, not only its kind", () => {
  test("a named guest link says its own name", () => {
    const label = viaLabel("invite:inv-1", [link], [], t);
    expect(label).toBe(`${dict["me.inviteGuestTitle"]} · ${fill("contact.adminInviteNamed", { name: "Family chat" })}`);
  });

  test("an unnamed guest link stays just the kind", () => {
    const label = viaLabel("invite:inv-1", [{ ...link, name: null }], [], t);
    expect(label).toBe(dict["me.inviteGuestTitle"]);
  });

  test("a named buddy link with a trip shows both the trip and the name", () => {
    const buddyLink: AdminInvite = { ...link, kind: "buddy", tripId: "iceland" };
    const label = viaLabel("invite:inv-1", [buddyLink], [{ id: "iceland", title: "Iceland 2026" }], t);
    expect(label).toBe(
      `${dict["me.inviteBuddyTitle"]} · ${fill("contact.adminInviteTrip", { trip: "Iceland 2026" })} · ${fill("contact.adminInviteNamed", { name: "Family chat" })}`,
    );
  });
});
