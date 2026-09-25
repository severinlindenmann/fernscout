import { isEnabled } from "@/lib/capabilities";
import { confirmContactFromSession, requestContact } from "@/lib/contacts";
import type { PostalAddress } from "@/lib/contacts/crypto";
import { pickLocale } from "@/lib/contacts/locale";
import { journalReader } from "@/lib/contacts/session";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { getUser } from "@/lib/users";
import { resolveViewer } from "@/lib/viewer";

export const dynamic = "force-dynamic";

/**
 * A person named in a trip's own `people:` block giving or correcting their
 * address — B1395.
 *
 * **The gap this closes.** Write access to a trip comes from two places:
 * `trip.md`'s hand-written `people:` block, or a redeemed buddy link
 * (`lib/tripPeople.ts`, `isPersonOnWith`). Only the second ever creates a
 * contacts row — a buddy link is redeemed through `/api/contacts/redeem`,
 * which writes one. Somebody the owner simply typed into `people:` has write
 * access and no row anywhere, so `/<user>/me` had nothing to offer them: no
 * manage token exists to reach `/api/contacts/manage`, and `/<user>/contacts`
 * is the owner's own page.
 *
 * **Why this is a separate door, and not `/api/contacts/manage` with an empty
 * token.** That route is keyed on a manage token, which is minted only once a
 * row exists (`manageTokenFor`) — there is nothing to look up yet. This one is
 * keyed on the session instead, the same shape as `/api/contacts/ask`: no
 * token, no id, just "whoever this cookie proves you are". `MePageContent`
 * keeps using the ordinary manage-token flow from the next page load on,
 * once `page.tsx` finds the row this door just wrote.
 *
 * **Gated on trip write access, not on being a contacts guest.** A person
 * named in `people:` may have no contacts row at all yet, so
 * `journalReader().guest` — which asks the contacts table — is the wrong
 * question. `resolveViewer` already answers the right one: `through ===
 * "traveller"` is exactly `isPersonOnWith`, the same fact that let them write
 * to the trip in the first place.
 *
 * **Filed confirmed, not `approveContact`'d.** The address is already proven
 * — this person is signed in as it, the same way `confirmContactFromSession`
 * lets an owner's own re-confirmation skip a second code (see
 * `/api/contacts/ask`). Mailing a code to an address that just authenticated
 * to write this exact row would ask it to prove the same thing twice.
 * `approveContact` is not called: it is the only thing in the codebase that
 * grants read access, and this person's write access already comes from
 * `people:` or a buddy link, never from this table. Every consent
 * (`wantsEmailDigest`, `wantsPostcard`, `wantsWhatsapp`) starts however this
 * request answers it — never assumed on — same as every other form that
 * writes this table.
 *
 * **Not in `openapi.json`.** Nothing under `app/api/contacts/` is — see
 * `AGENTS.md`.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const username = typeof body.user === "string" ? body.user : "";
  const user = getUser(username);

  if (!user || !isEnabled("contacts", username)) {
    return Response.json({ error: "contacts_disabled" }, { status: 404 });
  }

  const limit = rateLimitFor("contacts-self", clientIp(request), {
    max: 20,
    windowMs: 15 * 60 * 1000,
  });
  if (!limit.ok) {
    return Response.json(
      { error: "too_many_requests", retryAfter: limit.retryAfter },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const reader = await journalReader(username);
  if (!reader.email) return Response.json({ error: "not_signed_in" }, { status: 401 });

  // Write access to a trip earns this door, not a contacts-table grant — see
  // the module comment.
  const viewer = await resolveViewer(username);
  const isTraveller = viewer.trips.some((trip) => trip.through === "traveller");
  if (!isTraveller) return Response.json({ error: "forbidden" }, { status: 403 });

  const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
  if (name === "") return Response.json({ error: "invalid_name" }, { status: 400 });

  const locale = pickLocale(
    typeof body.locale === "string" ? body.locale : null,
    null,
    user.defaultLocale,
  );

  const result = await requestContact(username, {
    name,
    email: reader.email,
    locale,
    address: body.address === undefined ? undefined : (body.address as Partial<PostalAddress> | null),
    wantsEmailDigest: body.wantsEmailDigest === true,
    wantsPostcard: body.wantsPostcard === true,
    wantsWhatsapp: body.wantsWhatsapp === true,
    // Only written on the insert — `requestContact`'s update branch leaves
    // `created_via` alone — so a row already carrying "self:traveller" from
    // an earlier save here keeps recording that it was self-authored, which
    // is what `updateContactByOwner` reads to refuse the owner overwriting it.
    createdVia: "self:traveller",
  });

  // Blocked. There is nothing pending to write to and nothing to confirm —
  // and, unlike `/api/contacts/ask`, this caller needs to know their save
  // did not take effect rather than being told the same thing an ordinary
  // success would say, since there is no queue-shaped reason to keep this
  // one uniform.
  if (result.outcome === "ignored") {
    return Response.json({ error: "blocked" }, { status: 403 });
  }

  const confirmed = await confirmContactFromSession(username, reader.email);
  if (!confirmed.ok) return Response.json({ error: "confirm_failed" }, { status: 500 });

  return Response.json({ ok: true });
}
