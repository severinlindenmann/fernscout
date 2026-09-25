import { isEnabled } from "@/lib/capabilities";
import {
  confirmContactFromSession,
  getContactByEmail,
  markOwnerNotified,
  requestContact,
} from "@/lib/contacts";
import { pickLocale } from "@/lib/contacts/locale";
import { notifyOwnerOfRequest, sendConfirmedMail } from "@/lib/contacts/mail";
import { journalReader } from "@/lib/contacts/session";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

/**
 * Somebody standing in front of a closed trip asked to be let in — B601.
 *
 * **This is not the open guestbook coming back.** B37 removed `/{user}/join`
 * because the journal advertised a way in its owner never offered: a standing
 * public form, reachable by anyone who knew a username, asking strangers for a
 * name, an email and a postal address. Three things are different here, and
 * all three are load-bearing:
 *
 * - **A session is required.** The address is the one on the reader's own
 *   cookie — journal session or instance identity, `journalReader` asks
 *   `resolveAccess` — never one out of the body. Nobody can put a third party
 *   in front of the owner.
 * - **Nothing is asked for but a name.** No postal address, no phone number,
 *   no digest tick. Those are what made the old form worth spamming, and they
 *   are all still offered later, on the reader's own manage page, once the
 *   owner has actually let them in.
 * - **It is only offered where a reader has already been refused** —
 *   `TripGate`'s signed-in-and-refused branch. There is no page that advertises
 *   it to somebody who has not met a locked trip.
 *
 * What has not changed is the part B37 was careful about: this grants nothing.
 * The row is `pending`, `approveContact` is still the only thing in the
 * codebase that writes a grant, and the owner still decides by hand.
 *
 * **No second code.** The session was minted by `verifyCode` against six
 * digits mailed to this address, so the address is already proved —
 * `confirmContactFromSession` is the same shortcut a signed-in reader gets
 * when redeeming an invite link (B33). Asking them to prove it twice is the
 * friction that loses exactly the reader this page is for.
 *
 * **It says nothing the refusal did not already say.** One answer for every
 * outcome that is not a mistake in the request: a new row, a row already
 * waiting, a row already approved, an address that was blocked. An owner who
 * showed somebody the door does not announce it to them, and a button that
 * answered differently for a known address would be a way of asking what this
 * journal thinks of you.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const username = typeof body.user === "string" ? body.user : "";
  const user = getUser(username);

  if (!user || !isEnabled("contacts", username)) {
    return Response.json({ error: "contacts_disabled" }, { status: 404 });
  }

  const limit = rateLimitFor("contacts-ask", clientIp(request), {
    max: 5,
    windowMs: 15 * 60 * 1000,
  });
  if (!limit.ok) {
    return Response.json(
      { error: "too_many_requests", retryAfter: limit.retryAfter },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  // The address is the session's, and only the session's. Named plainly
  // rather than uniformly: a caller with no session is being told about their
  // own browser, which discloses nothing about this journal.
  const reader = await journalReader(username);
  if (!reader.email) return Response.json({ error: "not_signed_in" }, { status: 401 });

  const submittedName = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
  const known = reader.contact ?? (await getContactByEmail(username, reader.email));
  // Theirs first, then whatever this journal already had. Refused when both
  // are empty, for the reason `/api/contacts/redeem` gives: the owner is about
  // to make a decision about a person, and a row with no name on it is a
  // decision they cannot make.
  const name = submittedName || known?.name || "";
  if (name === "") return Response.json({ error: "invalid_name" }, { status: 400 });

  const locale = pickLocale(
    typeof body.locale === "string" ? body.locale : null,
    known?.locale ?? null,
    user.defaultLocale,
  );

  const result = await requestContact(username, {
    name,
    email: reader.email,
    locale,
    // Never asked, so never answered — `undefined` leaves whatever the reader
    // has already told this journal exactly as it is. An ask must not quietly
    // rewrite a choice somebody made on their own manage page.
    address: undefined,
    wantsEmailDigest: known?.wantsEmailDigest ?? false,
    wantsPostcard: known?.wantsPostcard ?? false,
    wantsWhatsapp: known?.wantsWhatsapp ?? false,
    // Only ever written on the insert — `requestContact`'s update branch
    // leaves `created_via` alone, so a reader who arrived through an invite
    // and later asked here keeps the record of how they actually arrived.
    createdVia: "asked",
  });

  // Blocked. Answered like everybody else — see the note above.
  if (result.outcome === "ignored") return accepted();

  const confirmed = await confirmContactFromSession(username, reader.email);
  if (!confirmed.ok) return accepted();

  // Both best-effort (B272): a courtesy mail that fails must not fail the ask
  // itself, which is already written and already in the queue.
  await sendConfirmedMail(username, user, confirmed.contact, confirmed.manageToken);
  // Only while the owner has not actually been told — `notified_at` turns
  // true when a send lands, so pressing the button twice never puts a second
  // request in front of them, and a first notification that never arrived is
  // still retried.
  if (confirmed.needsOwnerNotice) {
    const notified = await notifyOwnerOfRequest(username, user, confirmed.contact);
    if (notified) await markOwnerNotified(username, confirmed.contact.id);
  }

  return accepted();
}

/** The one answer. See the note above for why there is only one. */
function accepted(): Response {
  return Response.json({ status: "accepted" }, { status: 202 });
}
