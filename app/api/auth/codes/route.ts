import { isAdminEmail } from "@/lib/admin";
import { isEnabled } from "@/lib/capabilities";
import {
  CODE_TTL_MINUTES,
  NO_JOURNAL,
  isEmail,
  issueCode,
  revokeCodes,
  safeDestination,
  signInUrl,
  identitySignInUrl,
} from "@/lib/auth";
import { fromAcceptLanguage, pickLocale } from "@/lib/contacts/locale";
import { requestLocale, translateIn } from "@/lib/locales";
import { sendMail, sendTransactional } from "@/lib/mail";
import { renderMail, type MailBlock } from "@/lib/mail/template";
import { sendSignupCode } from "@/lib/signupCode";
import { sendWhatsappCode } from "@/lib/whatsapp";
import { toE164 } from "@/lib/whatsapp/phone";
import { authTemplateFor } from "@/lib/whatsapp/settings";
import { clientIp, emailCodeAllowed, rateLimitFor } from "@/lib/rateLimit";
import { serverSite } from "@/lib/site";
import { getUser } from "@/lib/users";
import { getTrip, tripRef } from "@/lib/trips";
import { isPersonOn } from "@/lib/tripPeople";
import { ERROR_CODES } from "@/lib/api/errorCodes";
import { fail, ok, readJson } from "@/lib/api/v2/route";
import { problemsFrom } from "@/lib/api/v2/incomplete";
import { codesRequest, type CodesRequest, type CredentialFor } from "@/lib/api/v2/schemas/auth";

export const dynamic = "force-dynamic";

/**
 * Ask for a one-time code — B1600, replacing `/api/auth/request`,
 * `/api/auth/identity/request` and `/api/auth/signup/request`
 * (`docs/plans/2026-09-12-api-v2/auth.md` §2.2). One door, parameterised by
 * `for`, so the rate limit, the uniform-202 rule and the mail-failure-revokes
 * guard exist in one place rather than three copies that can drift.
 *
 * **`202` for everything that depends on the address** (§0 property 6). The
 * refusals that are not about the address — shape, a capability off, the rate
 * limit, a send failure, and `for:"write"` to an address this journal does not
 * recognise — each say so where they stand.
 */
export async function POST(request: Request) {
  const body = await readJson(request);
  if (!body.ok) return body.response;
  const parsed = codesRequest.safeParse(body.value);
  if (!parsed.success) {
    return fail("invalid_request", ERROR_CODES.invalid_request, problemsFrom(parsed.error));
  }
  const req = parsed.data;
  const needsJournal = req.for === "read" || req.for === "write";

  // Shape-only cross-field rules — never address-dependent, so answering
  // distinctly here discloses nothing the uniform 202 below exists to protect.
  if (needsJournal && !req.user) {
    return fail(
      "invalid_request",
      'user is required when "for" is "read" or "write" — the code is for a journal.',
    );
  }
  if (!needsJournal && req.user !== undefined) {
    return fail(
      "invalid_request",
      'user names no journal, so it is refused when "for" is "identity" or "signup".',
    );
  }
  if (req.scope && req.for !== "write") {
    return fail("invalid_request", 'scope is only meaningful when "for" is "write".');
  }
  if (!isEmail(req.email)) {
    return fail("invalid_email", ERROR_CODES.invalid_email, undefined, 400);
  }

  /**
   * `auth` gates every `for` except `signup`, which has its own switch — a
   * server may take new journals with sign-in off, or vice versa.
   */
  if (req.for === "signup") {
    if (!isEnabled("signup")) return fail("signup_disabled", ERROR_CODES.signup_disabled, undefined, 404);
  } else if (!isEnabled("auth")) {
    return fail("auth_disabled", ERROR_CODES.auth_disabled, undefined, 404);
  }

  const channel = req.channel ?? "mail";
  /**
   * **Before anything is issued** (§0 property 8). `issueCode` supersedes
   * every live code for the address, so taking the success path with no way
   * to deliver would kill the code the person is still holding.
   */
  if (channel === "mail" && !isEnabled("mail")) {
    return fail(
      "mail_disabled",
      "This server cannot send mail, so there is no way to deliver a code. Nothing has been " +
        "issued and any code you already hold is still live.",
      undefined,
      503,
    );
  }
  if (channel === "whatsapp" && !isEnabled("whatsapp")) {
    return fail(
      "whatsapp_disabled",
      "This server cannot send WhatsApp messages, so there is no way to deliver a code this " +
        'way. Ask for the code by mail instead (leave "channel" out). Nothing has been issued ' +
        "and any code you already hold is still live.",
      undefined,
      503,
    );
  }

  // The per-address bucket the caller cannot see or spend around — V13:
  // narrower for "write" than for "read", since a write code answering
  // `not_authorised` for the wrong address is the one path on this door that
  // must stay slow to try.
  const rateCfg = RATE_LIMIT[req.for];
  const limit = rateLimitFor(`codes-${req.for}`, clientIp(request), rateCfg);
  if (!limit.ok) {
    const res = fail("too_many_requests", ERROR_CODES.too_many_requests, { retryAfter: limit.retryAfter }, 429);
    res.headers.set("Retry-After", String(limit.retryAfter));
    return res;
  }

  const accepted = () =>
    ok({ status: "accepted" as const, next: NEXT[req.for] }, { status: 202 });

  if (req.for === "identity") return handleIdentity(request, req, channel, accepted);
  if (req.for === "signup") return handleSignup(request, req, channel, accepted);
  return handleJournal(request, req, channel, accepted);
}

const RATE_LIMIT: Record<CredentialFor, { max: number; windowMs: number }> = {
  write: { max: 5, windowMs: 15 * 60 * 1000 },
  read: { max: 10, windowMs: 15 * 60 * 1000 },
  identity: { max: 5, windowMs: 60 * 60 * 1000 },
  signup: { max: 5, windowMs: 60 * 60 * 1000 },
};

const NEXT: Record<CredentialFor, string> = {
  read: 'POST /api/auth/codes/redeem with {"email", "code", "for": "read"}',
  write: 'POST /api/auth/codes/redeem with {"email", "code", "for": "write"}',
  identity: 'POST /api/auth/codes/redeem with {"email", "code", "for": "identity"} to sign in on this device.',
  signup: 'POST /api/auth/codes/redeem with {"email", "code", "for": "signup"} to get a token that can create one journal.',
};

/** `for:"identity"` — proves an address to the whole instance, names no
 * journal. Carried over from `/api/auth/identity/request` unchanged. */
async function handleIdentity(
  request: Request,
  req: CodesRequest,
  channel: "mail" | "whatsapp",
  accepted: () => Response,
) {
  // No owner to deliver a WhatsApp template to — an identity belongs to no
  // journal, so the same silent answer an unknown address gets by mail.
  if (channel === "whatsapp") return accepted();
  if (!emailCodeAllowed(req.email)) return accepted();

  const { code, linkToken } = await issueCode(NO_JOURNAL, req.email, "identity");
  const locale = pickLocale(req.locale ?? null, await requestLocale());
  const site = serverSite();
  const vars = { site: site.name, code, minutes: CODE_TTL_MINUTES };

  try {
    await sendMail(
      renderMail(req.email, translateIn(locale, "mail.identitySubject", vars), {
        preheader: translateIn(locale, "mail.identityCode", vars),
        title: translateIn(locale, "mail.identityTitle"),
        blocks: [
          { kind: "paragraph", text: translateIn(locale, "mail.identityCode", vars) },
          ...(linkToken
            ? ([
                {
                  kind: "button",
                  text: translateIn(locale, "mail.identityButton"),
                  href: identitySignInUrl(site.url, linkToken),
                },
                { kind: "paragraph", text: translateIn(locale, "mail.identityApp", vars) },
              ] as const)
            : []),
          { kind: "paragraph", text: translateIn(locale, "mail.identityWhat") },
          { kind: "paragraph", text: translateIn(locale, "mail.identityLasts") },
          { kind: "paragraph", text: translateIn(locale, "mail.identityIgnore") },
        ],
        footer: translateIn(locale, "mail.identityFooter", vars),
      }),
    );
  } catch (err) {
    console.error("[auth] identity code could not be sent:", err);
    await revokeCodes(NO_JOURNAL, req.email, "identity").catch(() => {});
    const res = fail(
      "mail_failed",
      "The code could not be sent, so no code is live for this address. Try again in a " +
        "minute; if it keeps failing, this server's mail is broken and the person who runs it " +
        "has to fix it.",
      undefined,
      503,
    );
    res.headers.set("Retry-After", "60");
    return res;
  }

  return accepted();
}

/** `for:"signup"` — proves an address on its way to creating exactly one
 * journal. `lib/signupCode.ts` already carries the whole mail side of this;
 * WhatsApp is not offered here, the same as v1. */
async function handleSignup(
  request: Request,
  req: CodesRequest,
  channel: "mail" | "whatsapp",
  accepted: () => Response,
) {
  if (channel === "whatsapp") return accepted();
  if (!emailCodeAllowed(req.email)) return accepted();

  const locale = pickLocale(
    req.locale ?? null,
    fromAcceptLanguage(request.headers.get("accept-language")),
  );
  if (!(await sendSignupCode(req.email, locale))) {
    const res = fail(
      "mail_failed",
      "The code could not be sent, so no code is live for this address. Nothing has been " +
        "created. Try again in a minute; if it keeps failing, this server's mail is broken and " +
        "the person who runs it has to fix it.",
      undefined,
      503,
    );
    res.headers.set("Retry-After", "60");
    return res;
  }
  return accepted();
}

/** `for:"read"` and `for:"write"` — a code for one journal. Carried over from
 * `/api/auth/request` unchanged beyond the vocabulary rename. */
async function handleJournal(
  request: Request,
  req: CodesRequest,
  channel: "mail" | "whatsapp",
  accepted: () => Response,
) {
  const username = req.user!;
  const user = getUser(username);
  if (!user) return accepted();

  /**
   * `auth` is also a per-journal opt-in (B252) — this is the journal's own
   * vote under the server-wide switch already checked. What it discloses for
   * a real journal is nothing new: the same absence is already on the page,
   * as a gate with no sign-in form.
   */
  if (!isEnabled("auth", username)) {
    return fail("auth_disabled", ERROR_CODES.auth_disabled, undefined, 404);
  }

  const tripId = req.scope?.trip?.trim() ?? "";

  if (req.for === "write" && !(await mayRequestAgentToken(user, tripId, req.email))) {
    console.warn(`[auth] write code refused for ${username}: not the owner or on that trip`);
    return fail(
      "not_authorised",
      `A write code for "${username}" is only sent to the address that owns it, or to somebody ` +
        `listed on a trip — and "${req.email.trim()}" is neither. If you are on one of its ` +
        `trips, name it: {"user": "${username}", "email": "…", "for": "write", "scope": ` +
        `{"trip": "<trip-id>"}}.`,
      undefined,
      403,
    );
  }

  const destination = req.for === "read" ? safeDestination(username, req.destination) : null;

  /**
   * WhatsApp delivery only ever reaches a number this journal has proven —
   * the owner's own, from signup. Any other address gets the same silent 202
   * an unknown address gets by mail.
   */
  let whatsappTel: string | null = null;
  if (channel === "whatsapp") {
    const ownersAddress =
      typeof user.owner.email === "string" &&
      user.owner.email.trim().toLowerCase() === req.email.trim().toLowerCase();
    const tel = user.owner.tel && user.owner.telProvenAt ? toE164(user.owner.tel) : null;
    if (!ownersAddress || !tel) return accepted();
    const day = 24 * 60 * 60 * 1000;
    const perNumber = rateLimitFor("whatsapp-code-number", tel, { max: 10, windowMs: day });
    if (!perNumber.ok) return accepted();
    const perInstance = rateLimitFor("whatsapp-code-instance", "*", { max: 100, windowMs: day });
    if (!perInstance.ok) return accepted();
    whatsappTel = tel;
  }

  if (channel === "mail" && !emailCodeAllowed(req.email)) return accepted();

  const { code, linkToken } = await issueCode(username, req.email, req.for === "write" ? "agent" : "guest", {
    destination,
    trip: req.for === "write" && tripId ? tripId : null,
  });
  const base = serverSite().url;

  const locale = pickLocale(
    user.defaultLocale,
    fromAcceptLanguage(request.headers.get("accept-language")),
  );
  const t = (key: Parameters<typeof translateIn>[1], vars?: Record<string, string>) =>
    translateIn(locale, key, vars);
  const vars = { site: serverSite().name, title: user.title, code, minutes: CODE_TTL_MINUTES };

  const guestBlocks: MailBlock[] = linkToken
    ? [
        { kind: "paragraph", text: t("mail.signinTap", vars) },
        { kind: "button", text: t("mail.signinOpen", vars), href: signInUrl(base, username, linkToken) },
        { kind: "paragraph", text: t("mail.signinCode", vars) },
      ]
    : [
        { kind: "paragraph", text: t("mail.identityCode", vars) },
        { kind: "button", text: t("mail.signinOpen", vars), href: `${base}/${username}` },
      ];

  const scopedTrip = req.for === "write" && tripId ? getTrip(tripRef(username, tripId)) : null;
  const agentBlocks: MailBlock[] = [
    { kind: "paragraph", text: t("mail.identityCode", vars) },
    {
      kind: "paragraph",
      text: scopedTrip ? t("mail.agentScoped", { ...vars, trip: scopedTrip.title }) : t("mail.agentAll"),
    },
  ];

  try {
    if (whatsappTel) {
      const template = authTemplateFor(locale);
      const sent = await sendWhatsappCode({
        to: whatsappTel,
        template: template.name,
        language: template.language,
        body: [code],
        buttonPath: code,
        username,
        category: "authentication",
      });
      if (!sent) throw new Error("the whatsapp capability went away mid-request");
    } else {
      await sendTransactional(
        renderMail(
          req.email,
          req.for === "write" ? t("mail.agentSubject", vars) : t("mail.signinSubject", vars),
          {
            preheader: t("mail.identityCode", vars),
            title: req.for === "write" ? t("mail.agentTitle") : t("mail.signinSubject", vars),
            blocks: [
              ...(req.for === "write" ? agentBlocks : guestBlocks),
              { kind: "paragraph", text: t("mail.codeAsked", { when: requestedAt(locale) }) },
              { kind: "paragraph", text: t("mail.signinIgnore") },
            ],
            footer: t("mail.identityFooter", vars),
          },
          username,
        ),
        "a one-time sign-in code the recipient just asked for",
      );
    }
  } catch (err) {
    console.error(`[auth] ${req.for} code for ${username} could not be sent (${channel}):`, err);
    await revokeCodes(username, req.email, req.for === "write" ? "agent" : "guest").catch(() => {});
    const res = fail(
      channel === "whatsapp" ? "whatsapp_failed" : "mail_failed",
      "The code could not be sent, so no code is live for this address. Try again in a minute; " +
        `if it keeps failing, this server's ${channel === "whatsapp" ? "WhatsApp channel" : "mail"} is broken.`,
      undefined,
      503,
    );
    res.headers.set("Retry-After", "60");
    return res;
  }

  return accepted();
}

/** `14:32 UTC, 1 September` — enough to tell two identical mails apart,
 * without pretending to know the reader's timezone. */
function requestedAt(locale: string): string {
  const now = new Date();
  const time = now.toISOString().slice(11, 16);
  const day = now
    .toLocaleDateString(locale === "en" ? "en-GB" : locale, {
      day: "numeric",
      month: "long",
      timeZone: "UTC",
    })
    .replace(/\.$/, "");
  return `${time} UTC, ${day}`;
}

/**
 * Whether this address may be sent a write code for this journal — the
 * owner's own, or somebody on the named trip. Carried over from
 * `/api/auth/request`'s `mayRequestAgentToken` unchanged.
 */
async function mayRequestAgentToken(
  user: { username: string; owner: { email?: string } },
  tripId: string,
  email: string,
): Promise<boolean> {
  const address = email.trim().toLowerCase();
  const isOwnerOrAdmin = user.owner.email === address || isAdminEmail(address);
  if (!tripId) return isOwnerOrAdmin;
  const trip = getTrip(tripRef(user.username, tripId));
  if (!trip) return false;
  return isOwnerOrAdmin || isPersonOn(trip, address);
}
