import { isEmail, issueCode } from "@/lib/auth";
import { readJsonBody } from "@/lib/api/jsonBody";
import { FOREIGN_ORIGIN_REFUSAL, foreignOrigin } from "@/lib/auth/originCheck";
import { setGuestSessionCookies } from "@/lib/auth/identityCookie";
import {
  confirmContactFromSession,
  getContactByEmail,
  manageTokenFor,
  markOwnerNotified,
  normaliseEmail,
  requestContact,
  updateContactSelf,
} from "@/lib/contacts";
import { verifyGuestCode } from "@/lib/contacts/guestCode";
import { parseLocale, pickLocale } from "@/lib/contacts/locale";
import { notifyOwnerOfRequest, sendCodeMail } from "@/lib/contacts/mail";
import { journalReader } from "@/lib/contacts/session";
import { maskEmail } from "@/lib/contacts/welcome";
import { mailDisabledReason } from "@/lib/mail";
import { clientIp, emailCodeAllowed, rateLimitFor } from "@/lib/rateLimit";
import { openTokenValid, recordKeep, resolveReadCode, type ReadLink } from "@/lib/tripLink";
import type { Locale } from "@/lib/types";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

const PER_IP = { max: 40, windowMs: 15 * 60 * 1000 };
const PER_CODE = { max: 200, windowMs: 60 * 60 * 1000 };
const NEW_PER_LINK = { max: 30, windowMs: 24 * 60 * 60 * 1000 };
const NO = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } as const;
const answer = (body: unknown, status = 200) => Response.json(body, { status, headers: NO });

/**
 * `POST /t/<code>/keep` — keeping a trip under your name (B-2962, epic B2960).
 *
 * The link comes from the path code alone. Same two guards as the press: the
 * page's CSRF token (`token` in the body) and a **strict** Origin — a missing
 * one is refused.
 *
 * **Keeping lets nobody in.** No grant, no trip place, no group, no approval:
 * a new person is filed `pending` (`createdVia: read:<inviteId>`) for the
 * owner's own answer, somebody already known keeps every detail they have, and
 * a blocked address gets the neutral answer and no keep row. Only the proof
 * primitives of the join flow are reused, never its settle.
 *
 * - `send` `{ name, email, locale }` — mails a code; writes nothing about anybody.
 * - `verify` `{ name, email, code, wantsDayMail }` — proves the address, then keeps.
 * - `join` `{ name, wantsDayMail }` — already signed in with an email: no second code.
 */
export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }) {
  if (!request.headers.get("origin") || foreignOrigin(request)) return answer(FOREIGN_ORIGIN_REFUSAL, 403);
  const { code } = await params;
  const jsonBody = await readJsonBody(request);
  if (!jsonBody.ok) return jsonBody.response;
  const body = (jsonBody.value ?? {}) as Record<string, unknown>;
  if (!openTokenValid(code, body.token)) return answer({ error: "bad_token" }, 403);
  const ip = clientIp(request);
  if (!rateLimitFor("trip-keep-ip", ip, PER_IP).ok || !rateLimitFor("trip-keep-code", code, PER_CODE).ok) {
    return answer({ error: "rate_limited" }, 429);
  }
  const link = await resolveReadCode(code);
  const user = link ? getUser(link.owner) : null;
  if (!link || !user) return answer({ error: "expired" }, 404);
  const owner = link.owner;

  const text = (key: string) => (typeof body[key] === "string" ? (body[key] as string).trim() : "");
  const name = text("name").slice(0, 120);
  const locale = pickLocale(parseLocale(text("locale")), user.defaultLocale);
  const wantsDayMail = body.wantsDayMail === true;

  switch (body.action) {
    case "send": {
      if (!name) return answer({ error: "invalid_name" }, 400);
      const email = normaliseEmail(text("email"));
      if (!isEmail(email)) return answer({ error: "invalid_email" }, 400);
      if (mailDisabledReason(owner)) return answer({ error: "unavailable" }, 503);
      if (!emailCodeAllowed(email)) return answer({ error: "rate_limited" }, 429);
      const { code: six } = await issueCode(owner, email, "guest");
      await sendCodeMail(owner, user, email, locale, six, null);
      return answer({ ok: true, to: maskEmail(email) });
    }
    case "verify": {
      const email = normaliseEmail(text("email"));
      const session = isEmail(email)
        ? await verifyGuestCode(owner, email, text("code"), request.headers.get("accept-language"))
        : null;
      if (!session) return answer({ error: "invalid_code" }, 401);
      await setGuestSessionCookies(session.token, session.subject, request.headers.get("user-agent"));
      return keep(link, email, { name, locale, wantsDayMail });
    }
    case "join": {
      const reader = await journalReader(owner);
      if (!reader.email || !isEmail(reader.email)) return answer({ error: "not_signed_in" }, 401);
      if (!name && !reader.contact?.name) return answer({ error: "invalid_name" }, 400);
      return keep(link, reader.email, { name, locale, wantsDayMail });
    }
    default:
      return answer({ error: "invalid_request" }, 400);
  }
}

/** The proved address keeps the trip. Blocked: the neutral answer, nothing written. */
async function keep(
  link: ReadLink,
  email: string,
  form: { name: string; locale: Locale; wantsDayMail: boolean },
): Promise<Response> {
  const { owner } = link;
  const done = { ok: true, kept: true, to: maskEmail(email) };
  const existing = await getContactByEmail(owner, email);
  if (existing?.status === "blocked") return answer(done);
  if (!existing) {
    if (!rateLimitFor("trip-keep-new", link.inviteId, NEW_PER_LINK).ok) return answer({ error: "rate_limited" }, 429);
    const filed = await requestContact(owner, {
      name: form.name,
      email,
      locale: form.locale,
      wantsEmailDigest: form.wantsDayMail,
      wantsPostcard: false,
      wantsWhatsapp: false,
      createdVia: `read:${link.inviteId}`,
    });
    if (filed.outcome === "ignored") return answer(done);
  }
  // The address is proved, so it is confirmed; that opens nothing.
  const confirmed = await confirmContactFromSession(owner, email);
  if (!confirmed.ok) return answer(done);
  const contact = confirmed.contact;
  if (existing && form.wantsDayMail && !existing.wantsEmailDigest) {
    await updateContactSelf(owner, manageTokenFor(owner, contact.id), { wantsEmailDigest: true });
  }
  if (!(await recordKeep(link, contact.id))) return answer({ error: "expired" }, 404);
  // The owner is told about a new person waiting, once.
  if (!existing && confirmed.needsOwnerNotice) {
    const user = getUser(owner);
    if (user && (await notifyOwnerOfRequest(owner, user, contact))) await markOwnerNotified(owner, contact.id);
  }
  return answer(done);
}
