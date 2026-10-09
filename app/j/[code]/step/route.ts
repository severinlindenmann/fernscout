import { isEmail, issueCode } from "@/lib/auth";
import { readJsonBody } from "@/lib/api/jsonBody";
import { FOREIGN_ORIGIN_REFUSAL, foreignOrigin } from "@/lib/auth/originCheck";
import { setGuestSessionCookies } from "@/lib/auth/identityCookie";
import { cookies } from "next/headers";
import { isEnabled } from "@/lib/capabilities";
import {
  addContactWithProvenPhone,
  approveContact,
  getContact,
  confirmContactFromSession,
  getContactByEmail,
  manageTokenFor,
  markContactPhoneProven,
  markOwnerNotified,
  normaliseEmail,
  requestContact,
  updateContactSelf,
  type ContactRecord,
  type SelfUpdate,
} from "@/lib/contacts";
import { confirmEmailProof, sendEmailProof, verifyGuestCode } from "@/lib/contacts/guestCode";
import { joinWhatsappAvailable, sendJoinSmsCode, typedDigits } from "@/lib/contacts/guestPhone";
import { applyLinkGroup } from "@/lib/contacts/groups";
import { countInviteUse } from "@/lib/contacts/invites";
import { parseLocale, pickLocale } from "@/lib/contacts/locale";
import { notifyOwnerOfRequest, sendCodeMail } from "@/lib/contacts/mail";
import type { Locale } from "@/lib/types";
import { journalReader } from "@/lib/contacts/session";
import { resolveJoinCode, type JoinInvite } from "@/lib/contacts/welcome";
import { mailDisabledReason } from "@/lib/mail";
import { setNewsConsent } from "@/lib/newsConsent";
import { whatsappCountryCode } from "@/lib/contactNumber";
import { createJoinPhoneLink, pollJoinPhoneLink } from "@/lib/phoneVerify/inboundLink";
import { isMessageable, phoneSubject, subjectPhone } from "@/lib/phone";
import { clientIp, emailCodeAllowed, rateLimitFor, rateLimitStatus, waJoinAllowed } from "@/lib/rateLimit";
import { claimTripPlace, isPersonOn } from "@/lib/tripPeople";
import { getTrip, tripRef } from "@/lib/trips";
import { serverSite } from "@/lib/site";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

const PER_IP = { max: 40, windowMs: 15 * 60 * 1000 };
const PER_CODE = { max: 200, windowMs: 60 * 60 * 1000 };
const WA_COOKIE = "fs_wa_join";
const WA_COOKIE_MAX_AGE_S = 30 * 60;
const NO = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } as const;
const answer = (body: unknown, status = 200) => Response.json(body, { status, headers: NO });

/**
 * `POST /j/<code>/step` — the group link's join flow (B2293, B2291 "Share an
 * invite link").
 *
 * **A reader link is the invitation** (B-2940). A new person who proves an
 * address through it is let in at once and the owner is told; the owner can
 * block them afterwards. A buddy link, or anybody the link merely found, still
 * ends at a `pending` contact and the owner's Let in (`approveContact`). A mailed invite from before the rebuild
 * (B319) is the one exception it always was: proving *exactly* the address
 * the owner typed lets that person in. B2597: B-2942: a mobile number may be proved
 * instead (`channel: "sms"` on send and verify, or `wa-start` and `wa-poll`
 * for a WhatsApp message-in), for sign-in only.
 *
 * - `send` `{ name, value, locale }` — mails a code, within the usual code
 *   budgets; writes nothing about anybody.
 * - `verify` `{ …, code }` — proves it; only now is a request filed (a new
 *   person) or a buddy place asked for (somebody already here, whose stored
 *   details are never touched). Signs this browser in (an identity opens
 *   nothing by itself) and tells the owner. `known: true` means the person
 *   was already on the page: the flow skips the address screen.
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
  const value = text("value");

  switch (body.action) {
    case "send": {
      // **Writes nothing about anybody** (security review F1): a code goes to
      // the address typed, and only a proved address files a request.
      if (!name) return answer({ error: "invalid_name" }, 400);
      if (body.channel === "sms") {
        // B-2942. A text to the number as typed; nothing is written about
        // anybody, and every limit fails closed (`sendJoinSmsCode`).
        const digits = typedDigits(value);
        if (!digits) return answer({ error: "invalid_phone" }, 400);
        const sent = await sendJoinSmsCode(owner, invite.id, digits, { ip, locale, siteTitle: serverSite().name });
        if (sent.ok) return answer({ ok: true, to: sent.to });
        const status = sent.reason === "rate_limited" ? 429 : sent.reason === "unsupported_country" ? 400 : 503;
        return answer({ error: sent.reason }, status);
      }
      if (body.channel !== undefined && body.channel !== "email") return answer({ error: "invalid_request" }, 400);
      const email = normaliseEmail(value);
      if (!isEmail(email)) return answer({ error: "invalid_email" }, 400);
      if (mailDisabledReason(owner)) return answer({ error: "unavailable" }, 503);
      // The per-address and per-instance mail budget every other code send
      // spends (F2): a group link is not a way to bomb somebody's inbox.
      if (!emailCodeAllowed(email)) return answer({ error: "rate_limited" }, 429);
      const { code: six, linkToken } = await issueCode(owner, email, "guest", { destination: `/j/${code}` });
      await sendCodeMail(owner, user, email, locale, six, linkToken, false, "join");
      return answer({ ok: true, to: email });
    }
    case "verify": {
      if (body.channel === "sms") {
        const digits = typedDigits(value);
        if (!digits) return answer({ error: "invalid_phone" }, 400);
        const subject = phoneSubject(digits);
        if (await linkCappedFor(invite, subject)) return answer({ error: "rate_limited" }, 429);
        const session = await verifyGuestCode(owner, subject, text("code"), request.headers.get("accept-language"));
        if (!session) return answer({ error: "invalid_code" }, 401);
        return signedInByPhone(request, invite, session, digits, { name, locale });
      }
      if (body.channel !== undefined && body.channel !== "email") return answer({ error: "invalid_request" }, 400);
      const email = normaliseEmail(value);
      // A link already at its daily cap answers before the code is spent, so
      // a capped newcomer can still use the same code once the window passes.
      if (isEmail(email) && (await linkCappedFor(invite, email))) return answer({ error: "rate_limited" }, 429);
      const session = isEmail(email) ? await verifyGuestCode(owner, email, text("code"), request.headers.get("accept-language")) : null;
      if (!session) return answer({ error: "invalid_code" }, 401);
      await setGuestSessionCookies(session.token, session.subject, request.headers.get("user-agent"));
      const settled = await joinProved(invite, email, { name, locale });
      if ("capped" in settled) return answer({ error: "rate_limited" }, 429);
      return answer({ ok: true, ...settled });
    }
    case "wa-start": {
      // B-2942. WhatsApp message-in: a wa.me link whose text carries a
      // one-time token. The row is bound to this link and to a secret only
      // this browser holds, so nobody else can collect the proof.
      if (!joinWhatsappAvailable()) return answer({ error: "unavailable" }, 404);
      if (!name) return answer({ error: "invalid_name" }, 400);
      const digits = typedDigits(value);
      if (!digits) return answer({ error: "invalid_phone" }, 400);
      if (!waJoinAllowed(digits, ip, invite.id)) return answer({ error: "rate_limited" }, 429);
      const jar = await cookies();
      const created = await createJoinPhoneLink(invite.id, digits, locale, jar.get(WA_COOKIE)?.value ?? null);
      if (!created) return answer({ error: "unavailable" }, 404);
      jar.set(WA_COOKIE, created.secret, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: `/j/${code}`,
        maxAge: WA_COOKIE_MAX_AGE_S,
      });
      return answer({ ok: true, id: created.id, link: created.link, text: created.text, expiresAt: created.expiresAt });
    }
    case "wa-poll": {
      if (!joinWhatsappAvailable()) return answer({ error: "unavailable" }, 404);
      const id = text("id");
      const secret = (await cookies()).get(WA_COOKIE)?.value;
      if (!id || !secret) return answer({ status: "expired" });
      const polled = await pollJoinPhoneLink(id, invite.id, secret);
      if (polled.status !== "ok") return answer({ status: polled.status });
      const digits = polled.phone;
      if (await linkCappedFor(invite, phoneSubject(digits))) return answer({ error: "rate_limited" }, 429);
      const minted = await mintPhoneSession(owner, digits);
      if (!minted) return answer({ status: "expired" });
      return signedInByPhone(request, invite, minted, digits, { name, locale });
    }
    case "join": {
      // Signed in already with an email on this instance: the address is
      // proved, so no second code (B2291 "An existing identity skips the code").
      const reader = await journalReader(owner);
      if (!reader.email || subjectPhone(reader.email)) return answer({ error: "not_signed_in" }, 401);
      if (!name && !reader.contact?.name) return answer({ error: "invalid_name" }, 400);
      const settled = await joinProved(invite, reader.email, { name, locale });
      if ("capped" in settled) return answer({ error: "rate_limited" }, 429);
      return answer({ ok: true, ...settled });
    }
    case "proof": {
      // B2453/B2454: a second channel for the person this link just filed —
      // a mobile after an email sign-up, or an email after a mobile one. The
      // same door the welcome guide's "Is this right?" uses (/w step): the
      // contact comes from this browser's session, never the body, and a
      // number is proved by its own code, never made a sign-in number.
      const reader = await journalReader(owner);
      const self = reader.contact;
      if (!self || self.status === "blocked") return answer({ error: "not_signed_in" }, 401);
      if (!filedByThisLink(self, invite)) return answer({ error: "already_known" }, 409);
      const given = text("code");
      if (!given) {
        const sent = await sendEmailProof(owner, self.id, value, { locale });
        return sent.ok ? answer({ ok: true, to: sent.to }) : answer({ error: sent.reason }, 409);
      }
      return (await confirmEmailProof(owner, self.id, value, given)) ? answer({ ok: true }) : answer({ error: "invalid_code" }, 401);
    }
    case "save": {
      const reader = await journalReader(owner);
      const self = reader.contact;
      if (!self || self.status === "blocked") return answer({ error: "not_signed_in" }, 401);
      // Only a person this very link filed: somebody already on the page
      // keeps what is stored — a join form never rewrites it (F1).
      if (!filedByThisLink(self, invite)) return answer({ error: "already_known" }, 409);
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
      // B2505: a mobile for WhatsApp postcards, given while the request
      // waits. Stored on the address like the one /me takes, unproved and
      // never a sign-in number; WhatsApp reaches only an active contact, so
      // nothing is sent to it before the owner lets this person in.
      if (typeof body.tel === "string" && body.tel.trim()) {
        const tel = body.tel.trim().slice(0, 40);
        if (!isMessageable(tel, whatsappCountryCode())) return answer({ error: "invalid_phone" }, 400);
        const on = self.postalAddress;
        patch.address = {
          ...(patch.address ?? {
            name: on?.name ?? self.name ?? "",
            line1: on?.line1 ?? "",
            line2: on?.line2 ?? "",
            postcode: on?.postcode ?? "",
            city: on?.city ?? "",
            country: on?.country ?? "",
          }),
          tel,
        };
      }
      for (const key of ["wantsEmailDigest", "wantsWhatsapp", "wantsSms", "wantsPostcard"] as const) {
        if (typeof body[key] === "boolean") patch[key] = body[key] as boolean;
      }
      // B2453: news from Fernscout is only ever asked, never assumed — a tick
      // records it; an unticked box writes nothing (an earlier consent given
      // elsewhere is not withdrawn by a join form, only on /me).
      if (body.wantsNews === true && self.email.includes("@")) await setNewsConsent(self.email, locale);
      const saved = await updateContactSelf(owner, manageTokenFor(owner, self.id), patch);
      return saved ? answer({ ok: true }) : answer({ error: "not_saved" }, 409);
    }
    default:
      return answer({ error: "invalid_request" }, 400);
  }
}

/**
 * The row this very link created, still waiting or let in by it — a
 * pre-approved address (B319) is active by the time it reaches the notify
 * step, and is no more "already on the page" than a waiting one. Anybody the
 * link merely found keeps what is stored (F1).
 */
function filedByThisLink(self: ContactRecord, invite: JoinInvite): boolean {
  return self.createdVia === `invite:${invite.id}` && (self.status === "pending" || self.status === "active");
}

type Settled = { status: "in" | "waiting"; known: boolean };

/** B2665 round 2 — at most this many brand-new requests through any one
 * link in a day. A link shared once (even a standing "Ask to read along"
 * one) is not a way to flood the owner's queue; somebody the owner already
 * knows (`existing`) never counts against it. */
const NEW_REQUEST_PER_LINK_LIMIT = { max: 30, windowMs: 24 * 60 * 60 * 1000 };

/** Whether this address would be refused by the per-link cap — a peek that
 * spends nothing; `joinProved` still does the counting. */
async function linkCappedFor(invite: JoinInvite, email: string): Promise<boolean> {
  if (await getContactByEmail(invite.owner, email)) return false;
  return !rateLimitStatus("join-new-request-link", invite.id, NEW_REQUEST_PER_LINK_LIMIT).ok;
}

/** The browser that proved `digits` is signed in as that number, and the
 * person is let in exactly as an email proof would. */
async function signedInByPhone(
  request: Request,
  invite: JoinInvite,
  session: { token: string; subject: string },
  digits: string,
  form: { name: string; locale: Locale },
): Promise<Response> {
  await setGuestSessionCookies(session.token, session.subject, request.headers.get("user-agent"));
  const settled = await joinProvedPhone(invite, digits, form);
  if ("capped" in settled) return answer({ error: "rate_limited" }, 429);
  return answer({ ok: true, ...settled });
}

/** A session for a number an inbound message proved: a guest code issued and
 * redeemed in one step (the one `verifyCode` every sign-in goes through). */
async function mintPhoneSession(owner: string, digits: string) {
  const subject = phoneSubject(digits);
  const { code } = await issueCode(owner, subject, "guest");
  return verifyGuestCode(owner, subject, code);
}

/**
 * A number this request just proved (a code, or an inbound message). Same
 * shape as `joinProved`: a new person gets a `pending` row stamped proven and
 * is let in by `settle`; somebody already here keeps every detail they have;
 * blocked answers like anybody else.
 */
async function joinProvedPhone(
  invite: JoinInvite,
  digits: string,
  form: { name: string; locale: Locale },
): Promise<Settled | { capped: true }> {
  const owner = invite.owner;
  const subject = phoneSubject(digits);
  const existing = await getContactByEmail(owner, subject);
  if (existing?.status === "blocked") return { status: "waiting", known: true };
  let contact = existing;
  if (!contact) {
    if (!rateLimitFor("join-new-request-link", invite.id, NEW_REQUEST_PER_LINK_LIMIT).ok) return { capped: true };
    const created = await addContactWithProvenPhone(owner, {
      name: form.name,
      phone: subject,
      locale: form.locale,
      createdVia: `invite:${invite.id}`,
    });
    if (!created.ok) return { status: "waiting", known: true };
    contact = created.contact;
  } else {
    // A number only a typed entry held is proved now (verifyGuestCode stamped
    // it for a code; an inbound message stamps it here).
    contact = (await markPhoneProvenFor(owner, digits)) ?? (await getContact(owner, contact.id)) ?? contact;
  }
  if (contact.status === "blocked") return { status: "waiting", known: true };
  return settle(invite, contact, subject, existing ? false : true);
}

async function markPhoneProvenFor(owner: string, digits: string) {
  await markContactPhoneProven(owner, digits);
  return getContactByEmail(owner, phoneSubject(digits));
}

/**
 * An address this request just proved. A new person gets a `pending` row with
 * the form's name and language; **somebody already here keeps every detail
 * they have** (F1, B2294's rule): the form's values are not written over
 * them. Blocked: nothing, answered like anybody else.
 */
async function joinProved(
  invite: JoinInvite,
  email: string,
  form: { name: string; locale: Locale },
): Promise<Settled | { capped: true }> {
  const existing = await getContactByEmail(invite.owner, email);
  if (existing?.status === "blocked") return { status: "waiting", known: true };
  if (!existing) {
    if (!rateLimitFor("join-new-request-link", invite.id, NEW_REQUEST_PER_LINK_LIMIT).ok) {
      return { capped: true };
    }
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
  // TIX-6. The link's group, by `groupOnJoin`'s rule: new or ungrouped people
  // go in; somebody already in another group is only asked about, never moved.
  await applyLinkGroup(owner, contact.id, invite.groupId);
  const trip = invite.kind === "buddy" && invite.tripId ? getTrip(tripRef(owner, invite.tripId)) : null;
  if (trip) {
    if (await isPersonOn(trip, subject)) return { status: "in", known };
    await claimTripPlace(owner, trip.id, contact.id, invite.id);
  } else if (contact.status === "active") {
    return { status: "in", known };
  }
  await countInviteUse(owner, invite.id);
  // B-2940: a reader link is the invitation. Somebody this very link filed
  // and who proved their address is let in at once; the owner is told they
  // joined and can block them. Buddy links (a trip place, write access) and
  // anybody the link merely found keep the owner's Let in. A link mailed to one
  // address (`emailKey`, B319) admits exactly that address and nobody else.
  if (invite.kind === "guest" && !invite.emailKey && !trip && contact.status === "pending" && contact.createdVia === `invite:${invite.id}`) {
    const approved = await approveContact(owner, contact.id, { onlyTrip: null });
    if (approved?.contact.status === "active") {
      if (needsOwnerNotice !== false) {
        const notified = await notifyOwnerOfRequest(owner, user, approved.contact, { joined: true });
        if (notified) await markOwnerNotified(owner, contact.id);
      }
      return { status: "in", known };
    }
    return { status: "waiting", known };
  }
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
