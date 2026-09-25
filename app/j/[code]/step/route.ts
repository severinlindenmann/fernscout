import { isEmail, issueCode } from "@/lib/auth";
import { readJsonBody } from "@/lib/api/jsonBody";
import { FOREIGN_ORIGIN_REFUSAL, foreignOrigin } from "@/lib/auth/originCheck";
import { setGuestSessionCookies } from "@/lib/auth/identityCookie";
import { isEnabled } from "@/lib/capabilities";
import {
  approveContact,
  confirmContactFromSession,
  getContactByEmail,
  manageTokenFor,
  markOwnerNotified,
  normaliseEmail,
  requestContact,
  updateContactSelf,
  type ContactRecord,
  type SelfUpdate,
} from "@/lib/contacts";
import { proveFirstPhone, sendFirstPhoneCode, verifyGuestCode } from "@/lib/contacts/guestCode";
import { countInviteUse } from "@/lib/contacts/invites";
import { parseLocale, pickLocale } from "@/lib/contacts/locale";
import { notifyOwnerOfRequest, sendCodeMail } from "@/lib/contacts/mail";
import type { Locale } from "@/lib/types";
import { journalReader } from "@/lib/contacts/session";
import { resolveJoinCode, type JoinInvite } from "@/lib/contacts/welcome";
import { mailDisabledReason } from "@/lib/mail";
import { subjectPhone } from "@/lib/phone";
import { clientIp, emailCodeAllowed, rateLimitFor } from "@/lib/rateLimit";
import { claimTripPlace, isPersonOn } from "@/lib/tripPeople";
import { getTrip, tripRef } from "@/lib/trips";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

const PER_IP = { max: 40, windowMs: 15 * 60 * 1000 };
const PER_CODE = { max: 200, windowMs: 60 * 60 * 1000 };
const NO = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } as const;
const answer = (body: unknown, status = 200) => Response.json(body, { status, headers: NO });

/**
 * `POST /j/<code>/step` — the group link's join flow (B2293, B2291 "Share an
 * invite link").
 *
 * **Joining is asking.** Every path here ends at a `pending` contact whose
 * channel is proved, and the owner's Let in (`approveContact`) is still the
 * only thing that opens anything. A mailed invite from before the rebuild
 * (B319) is the one exception it always was: proving *exactly* the address
 * the owner typed lets that person in.
 *
 * - `send` `{ name, channel: "email" | "sms", value, locale }` — mails or
 *   texts a code, within the usual code budgets; writes nothing about anybody.
 * - `verify` `{ …, code }` — proves it; only now is a request filed (a new
 *   person) or a buddy place asked for (somebody already here, whose stored
 *   details are never touched). Signs this browser in (an identity opens
 *   nothing by itself) and tells the owner. `known: true` means the person
 *   was already on the page: the flow skips the address and channel screens.
 * - `join` `{ name, locale }` — somebody already signed in with an email on
 *   this instance: no second code.
 * - `save` `{ address?, wants… }` — the person's own details, from their
 *   session only.
 */
export async function POST(request: Request, { params }: RouteContext<"/j/[code]/step">) {
  if (foreignOrigin(request)) return answer(FOREIGN_ORIGIN_REFUSAL, 403);
  const { code } = await params;
  const ip = clientIp(request);
  if (!rateLimitFor("join-step-ip", ip, PER_IP).ok || !rateLimitFor("join-step-code", code, PER_CODE).ok) {
    return answer({ error: "rate_limited" }, 429);
  }
  const invite = isEnabled("contacts") ? await resolveJoinCode(code) : null;
  const user = invite && isEnabled("contacts", invite.owner) ? getUser(invite.owner) : null;
  if (!invite || !user) return answer({ error: "expired" }, 404);
  if (invite.tripId && !getTrip(tripRef(invite.owner, invite.tripId))) return answer({ error: "expired" }, 404);
  const owner = invite.owner;

  const jsonBody = await readJsonBody(request);
  if (!jsonBody.ok) return jsonBody.response;
  const body = (jsonBody.value ?? {}) as Record<string, unknown>;
  const text = (key: string) => (typeof body[key] === "string" ? (body[key] as string).trim() : "");
  const name = text("name").slice(0, 120);
  const locale = pickLocale(parseLocale(text("locale")), invite.locale, user.defaultLocale);
  const channel = body.channel === "sms" ? "sms" : "email";
  const value = text("value");

  switch (body.action) {
    case "send": {
      // **Writes nothing about anybody** (security review F1): a code goes to
      // the channel typed, and only a proved channel files a request.
      if (!name) return answer({ error: "invalid_name" }, 400);
      if (channel === "sms") {
        const sent = await sendFirstPhoneCode(owner, value, { ip, locale });
        return sent.ok ? answer({ ok: true, to: sent.to }) : answer({ error: sent.reason }, sent.reason === "rate_limited" ? 429 : 400);
      }
      const email = normaliseEmail(value);
      if (!isEmail(email)) return answer({ error: "invalid_email" }, 400);
      if (mailDisabledReason(owner)) return answer({ error: "unavailable" }, 503);
      // The per-address and per-instance mail budget every other code send
      // spends (F2): a group link is not a way to bomb somebody's inbox.
      if (!emailCodeAllowed(email)) return answer({ error: "rate_limited" }, 429);
      const { code: six, linkToken } = await issueCode(owner, email, "guest", { destination: `/j/${code}` });
      await sendCodeMail(owner, user, email, locale, six, linkToken);
      return answer({ ok: true, to: email });
    }
    case "verify": {
      if (channel === "sms") {
        const proved = await proveFirstPhone(owner, value, text("code"), { name, locale, createdVia: `invite:${invite.id}` });
        if (!proved) return answer({ error: "invalid_code" }, 401);
        if (proved.contact.status === "blocked") return answer({ ok: true, status: "waiting", known: true });
        await setGuestSessionCookies(proved.token, proved.subject, request.headers.get("user-agent"));
        return answer({ ok: true, ...(await settle(invite, proved.contact, proved.subject, null)) });
      }
      const email = normaliseEmail(value);
      const session = isEmail(email) ? await verifyGuestCode(owner, email, text("code")) : null;
      if (!session) return answer({ error: "invalid_code" }, 401);
      await setGuestSessionCookies(session.token, session.subject, request.headers.get("user-agent"));
      return answer({ ok: true, ...(await joinProved(invite, email, { name, locale })) });
    }
    case "join": {
      // Signed in already with an email on this instance: the address is
      // proved, so no second code (B2291 "An existing identity skips the code").
      const reader = await journalReader(owner);
      if (!reader.email || subjectPhone(reader.email)) return answer({ error: "not_signed_in" }, 401);
      if (!name && !reader.contact?.name) return answer({ error: "invalid_name" }, 400);
      return answer({ ok: true, ...(await joinProved(invite, reader.email, { name, locale })) });
    }
    case "save": {
      const reader = await journalReader(owner);
      const self = reader.contact;
      if (!self || self.status === "blocked") return answer({ error: "not_signed_in" }, 401);
      // Only a request this very link filed, still waiting: somebody already
      // on the page keeps what is stored — a join form never rewrites it (F1).
      if (self.status !== "pending" || self.createdVia !== `invite:${invite.id}`) {
        return answer({ error: "already_known" }, 409);
      }
      const patch: SelfUpdate = {};
      const address = body.address as Record<string, unknown> | undefined;
      if (address && typeof address === "object") {
        const field = (key: string) => (typeof address[key] === "string" ? (address[key] as string) : "");
        // No `tel`: the number on file stays as it is; a self write never
        // makes a phone a sign-in number (B2294).
        patch.address = {
          name: self.name ?? "",
          line1: field("line1"),
          line2: "",
          postcode: field("postcode"),
          city: field("city"),
          country: field("country"),
        };
      }
      for (const key of ["wantsEmailDigest", "wantsWhatsapp", "wantsSms", "wantsPostcard"] as const) {
        if (typeof body[key] === "boolean") patch[key] = body[key] as boolean;
      }
      const saved = await updateContactSelf(owner, manageTokenFor(owner, self.id), patch);
      return saved ? answer({ ok: true }) : answer({ error: "not_saved" }, 409);
    }
    default:
      return answer({ error: "invalid_request" }, 400);
  }
}

type Settled = { status: "in" | "waiting"; known: boolean };

/**
 * An address this request just proved. A new person gets a `pending` row with
 * the form's name and language; **somebody already here keeps every detail
 * they have** (F1, B2294's rule): the form's values are not written over
 * them. Blocked: nothing, answered like anybody else.
 */
async function joinProved(invite: JoinInvite, email: string, form: { name: string; locale: Locale }): Promise<Settled> {
  const existing = await getContactByEmail(invite.owner, email);
  if (existing?.status === "blocked") return { status: "waiting", known: true };
  if (!existing) {
    const filed = await requestContact(invite.owner, {
      name: form.name,
      email,
      locale: form.locale,
      wantsEmailDigest: false,
      wantsPostcard: false,
      wantsWhatsapp: false,
      createdVia: `invite:${invite.id}`,
    });
    if (filed.outcome === "ignored") return { status: "waiting", known: true };
  }
  const confirmed = await confirmContactFromSession(invite.owner, email);
  if (!confirmed.ok) return { status: "waiting", known: true };
  return settle(invite, confirmed.contact, email, existing ? false : confirmed.needsOwnerNotice);
}

/**
 * Where a proved person stands with this link. A reader link for somebody
 * already in: in, nothing written. A buddy link: a request for that trip (a
 * place with no grant) unless they already hold it. Pre-approved (the owner
 * mailed this invite to exactly this address, B319, and they are not in
 * yet) → let in. Otherwise the owner is told a request is waiting, once.
 */
async function settle(
  invite: JoinInvite,
  contact: ContactRecord,
  subject: string,
  needsOwnerNotice: boolean | null,
): Promise<Settled> {
  const owner = invite.owner;
  const user = getUser(owner)!;
  const known = !(contact.createdVia === `invite:${invite.id}` && contact.status === "pending");
  const trip = invite.kind === "buddy" && invite.tripId ? getTrip(tripRef(owner, invite.tripId)) : null;
  if (trip) {
    if (await isPersonOn(trip, subject)) return { status: "in", known };
    await claimTripPlace(owner, trip.id, contact.id, invite.id);
  } else if (contact.status === "active") {
    return { status: "in", known };
  }
  await countInviteUse(owner, invite.id);
  if (contact.status === "pending" && invite.emailKey && contact.email && invite.emailKey === contact.email) {
    const approved = await approveContact(owner, contact.id);
    if (approved?.contact.status === "active") return { status: "in", known };
  }
  // A new request, or a buddy request from somebody already here.
  if (needsOwnerNotice !== false || trip) {
    const notified = await notifyOwnerOfRequest(owner, user, contact);
    if (notified) await markOwnerNotified(owner, contact.id);
  }
  return { status: "waiting", known };
}
