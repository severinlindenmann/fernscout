import { isAdminEmail } from "@/lib/admin";
import { isEnabled } from "@/lib/capabilities";
import {
  CODE_TTL_MINUTES,
  isEmail,
  issueCode,
  revokeCodes,
  safeDestination,
  signInUrl,
  type SessionKind,
} from "@/lib/auth";
import { fromAcceptLanguage, pickLocale } from "@/lib/contacts/locale";
import { translateIn } from "@/lib/locales";
import { sendTransactional } from "@/lib/mail";
import { renderMail, type MailBlock } from "@/lib/mail/template";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { serverSite } from "@/lib/site";
import { getUser } from "@/lib/users";
import { getTrip, tripRef } from "@/lib/trips";
import { isPersonOn } from "@/lib/tripPeople";

export const dynamic = "force-dynamic";

/**
 * Ask for a one-time code.
 *
 * **`202` for everything that depends on the address.** A different answer for
 * a known address than for an unknown one turns this endpoint into a way of
 * asking which of your family are registered, and — for agent codes — which
 * address owns the site. The mail is the side effect; the response carries no
 * signal about who was asked for.
 *
 * The refusals that are not about the address are exempt, and each says so
 * where it stands: `auth` off (404), the rate limit (429), a missing
 * `username` or an `email` that fails the syntax check (400 — B1026, shape
 * only, never a lookup), an agent code for an address this journal does not
 * recognise (403, and the trade is argued below), mail switched off for the
 * whole server (503), and a send that failed (503). None of them varies with
 * the address, which is the property that matters rather than the uniform
 * status.
 */
export async function POST(request: Request) {
  if (!isEnabled("auth")) {
    return Response.json({ error: "auth_disabled" }, { status: 404 });
  }

  /**
   * **Before anything is issued** — B160.
   *
   * This route's rule is that every outcome is a 202, because a status that
   * varied by address would say which of somebody's family is registered. A
   * server that cannot send mail at all says nothing about any address, so
   * refusing here leaks nothing the uniform 202 was protecting.
   *
   * What it stops is worse than an unhelpful answer. `issueCode` revokes every
   * live code for the address before writing a new one, and the mail layer
   * returns null rather than throwing when mail is off — so the route took the
   * success path and answered 202 having *killed the code the person was still
   * holding* and replaced it with one nobody would ever be told. The `catch`
   * below already has the right answer for a transport that throws; "mail is
   * switched off" is not an exception, so it never reached it.
   *
   * The signup route refuses the same way and for the same reason
   * (`app/api/auth/signup/request/route.ts`), as does `lib/deletions.ts`.
   * Before the rate limit, so a request that was never going to work does not
   * spend a person's five attempts.
   */
  if (!isEnabled("mail")) {
    return Response.json(
      {
        error: "mail_disabled",
        message:
          "This server cannot send mail, so there is no way to deliver a code. Nothing has " +
          "been issued and any code you already hold is still live.",
      },
      { status: 503 },
    );
  }

  // Read before rate-limiting, because which bucket applies depends on what
  // is being asked for.
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const email = typeof body.email === "string" ? body.email : "";
  const username = typeof body.user === "string" ? body.user : "";
  const kind: SessionKind = body.kind === "agent" ? "agent" : "guest";

  // Agent requests get a smaller bucket than guest ones: they are the path
  // that now says whether an address owns a journal, so enumerating addresses
  // has to stay expensive. A person asking for their own code needs one or two.
  const limit = rateLimitFor(
    kind === "agent" ? "auth-request-agent" : "auth-request",
    clientIp(request),
    { max: kind === "agent" ? 5 : 10, windowMs: 15 * 60 * 1000 },
  );
  if (!limit.ok) {
    return Response.json(
      { error: "too_many_requests", retryAfter: limit.retryAfter },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }
  // Optional, and only meaningful for an agent token: which trip the caller is
  // asking to write to. Somebody who is on a trip but does not own the journal
  // gets a token scoped to that trip and nothing else.
  const tripId = typeof body.trip === "string" ? body.trip.trim() : "";

  /**
   * Where the button in the mail should land — the page the form was sitting
   * on. Only the trip gate sends one; `/<user>/me` deliberately does not, and
   * neither does anything that mails a link without a reader in front of it.
   *
   * **Stored, never echoed.** It goes into the row beside the link's hash and
   * is read back at redemption, so no URL anywhere carries a redirect target
   * somebody can substitute. `safeDestination` refuses anything that is not a
   * path inside this journal — checked here so nothing unusable is written
   * down, and again on the way out, which is the check that counts.
   */
  const destination = safeDestination(username, body.destination);

  /**
   * **Shape, not existence.** Whether `isEmail()` accepts a string is a pure
   * format check that no lookup touches, so refusing it by name leaks nothing
   * about who is registered — the same is true of `username` being present at
   * all. Naming the broken field is what the uniform `202` below still exists
   * to keep from doing for a *syntactically valid* address this journal
   * simply does not recognise. B1026.
   */
  if (!username) {
    return Response.json({ error: "invalid_user", message: "user is required." }, { status: 400 });
  }
  if (!isEmail(email)) {
    return Response.json(
      { error: "invalid_email", message: "email is required and must be a valid address." },
      { status: 400 },
    );
  }

  const accepted = Response.json({ status: "accepted" }, { status: 202 });
  const user = getUser(username);
  if (!user) return accepted;

  /**
   * `auth` is a per-journal opt-in, exactly like every other capability
   * (`lib/capabilities.ts`) — B252. Before this, this route and `/api/auth/
   * verify` asked only whether the *server* had `auth` on at all, while the
   * trip gate (`app/[user]/trips/[trip]/layout.tsx`) and `/api/health` asked
   * per journal — so a journal whose own `config.json` never mentioned `auth`
   * still had codes minted and guest sessions issued against its name, while
   * its own gate told a reader there was no way in.
   *
   * What the 404 discloses is nothing new: the same absence is already on the
   * page, as a gate with no sign-in form.
   */
  if (!isEnabled("auth", username)) {
    return Response.json({ error: "auth_disabled" }, { status: 404 });
  }

  /**
   * An agent token can write, so the address has to be one this journal
   * recognises: the owner, or somebody listed on the trip they named.
   *
   * **This answers truthfully, and that is a deliberate trade.** Every other
   * failure on this endpoint returns the same 202, because a status that
   * varied by address would let anyone ask which of somebody's family is
   * registered. Here the cost of that silence fell on the wrong person: an
   * agent asking for a code it was never going to receive waited, retried, and
   * had no way to learn it was knocking on a journal it does not own. Days
   * were lost to it.
   *
   * What leaks is narrower than it looks. Guest codes — the ones tied to a
   * reader's address — still answer 202 for everything, so the "who reads this
   * journal" question is as unanswerable as it was. What a caller can now
   * learn is whether a *given address owns a given journal*, which the journal
   * already tells its own owner and which the rate limit below makes slow to
   * enumerate.
   */
  if (kind === "agent" && !(await mayRequestAgentToken(user, tripId, email))) {
    console.warn(`[auth] agent code refused for ${username}: not the owner or on that trip`);
    return Response.json(
      {
        error: "not_authorised",
        message:
          `An agent code for "${username}" is only sent to the address that owns it, or to ` +
          `somebody listed on a trip — and "${email.trim()}" is neither. Ask whoever owns the ` +
          `journal which address to use. If you are on one of its trips, name the trip: ` +
          `{"user": "${username}", "email": "…", "kind": "agent", "trip": "<trip-id>"}.`,
      },
      { status: 403 },
    );
  }

  /**
   * The trip goes **onto the code**, not into the answer — B230.
   *
   * `mayRequestAgentToken` has just decided that this address may write to
   * this trip and nothing else. Writing the trip down beside the code is what
   * makes that decision survive to redemption: `/api/auth/verify` reads it off
   * the row, so there is no field for a caller to leave out and no second
   * value to disagree with. Before this it was re-sent at verify time, where
   * an unrecognised value meant "no narrowing" — the journal's own
   * `write:content`, to somebody who had been let onto one trip.
   *
   * Only for an agent code, and only when a trip was named. The owner asking
   * for a journal-wide token names none, and that is the one case that still
   * mints `write:content`.
   */
  const { code, linkToken } = await issueCode(username, email, kind, {
    destination,
    trip: kind === "agent" && tripId ? tripId : null,
  });
  const base = serverSite().url;

  /**
   * The language the mail is written in — B857.
   *
   * The journal's own `defaultLocale` first, because a journal that says it is
   * Hungarian is one whose owner and readers are, and only then whatever the
   * request asked for. English is what is left when neither names a language
   * this instance ships chrome for. The journal's *title* is not translated
   * and never could be: it is the owner's own words, interpolated as they
   * wrote them (B316).
   */
  const locale = pickLocale(
    user.defaultLocale,
    fromAcceptLanguage(request.headers.get("accept-language")),
  );
  const t = (key: Parameters<typeof translateIn>[1], vars?: Record<string, string>) =>
    translateIn(locale, key, vars);
  const vars = {
    site: serverSite().name,
    title: user.title,
    code,
    minutes: CODE_TTL_MINUTES,
  };

  /**
   * A reader gets a button; an agent gets a code.
   *
   * The button is first and the code is underneath, because one tap is what a
   * person opening this on a phone will actually do, and copying six digits
   * between two devices is where the other kind of reader gives up. Both work,
   * and using the code does not require having ignored the button.
   */
  const guestBlocks: MailBlock[] = linkToken
    ? [
        { kind: "paragraph", text: t("mail.signinTap", vars) },
        {
          kind: "button",
          text: t("mail.signinOpen", vars),
          href: signInUrl(base, username, linkToken),
        },
        { kind: "paragraph", text: t("mail.signinCode", vars) },
      ]
    : [
        { kind: "paragraph", text: t("mail.identityCode", vars) },
        { kind: "button", text: t("mail.signinOpen", vars), href: `${base}/${username}` },
      ];

  /**
   * The same trip `issueCode` just put on the row, resolved to a title —
   * B348. `mayRequestAgentToken` already checked this address may write to
   * it, so a trip named here is one this code really is scoped to.
   */
  const scopedTrip = kind === "agent" && tripId ? getTrip(tripRef(username, tripId)) : null;

  const agentBlocks: MailBlock[] = [
    { kind: "paragraph", text: t("mail.identityCode", vars) },
    {
      kind: "paragraph",
      text: scopedTrip
        ? t("mail.agentScoped", { ...vars, trip: scopedTrip.title })
        : t("mail.agentAll"),
    },
  ];

  /**
   * Guarded, and a failure takes the code back — see the note on the signup
   * route, which had the same defect and lost somebody a working code to it.
   *
   * The answer breaks this endpoint's own rule that every outcome is a 202,
   * and that is fine: "this server could not send mail at all" says nothing
   * about the address, which is the thing the uniform 202 exists to protect.
   */
  try {
    /**
     * Sent whatever the journal's own `features.mail.enabled` says.
     *
     * A one-time code is not a letter to a reader — it is the door. A journal
     * that has switched its mail off has said "do not write to my readers",
     * and reading that as "and lock me out of my own journal" would make the
     * setting unrecoverable: the code is the only way to get a session or a
     * token, so there would be nothing left to switch it back on with. See
     * `sendTransactional` in lib/mail, and B60.
     */
    await sendTransactional(
      renderMail(
        email,
        kind === "agent" ? t("mail.agentSubject", vars) : t("mail.signinSubject", vars),
        {
          // What a phone shows next to the subject. The code, not the link:
          // a reader who only glances at the notification can still type it in.
          preheader: t("mail.identityCode", vars),
          title: kind === "agent" ? t("mail.agentTitle") : t("mail.signinSubject", vars),
          blocks: [
            ...(kind === "agent" ? agentBlocks : guestBlocks),
            { kind: "paragraph", text: t("mail.codeAsked", { when: requestedAt(locale) }) },
            { kind: "paragraph", text: t("mail.signinIgnore") },
          ],
          footer: t("mail.identityFooter", vars),
        },
        username,
      ),
      "a one-time sign-in code the recipient just asked for",
    );
  } catch (err) {
    console.error(`[auth] ${kind} code for ${username} could not be sent:`, err);
    await revokeCodes(username, email, kind).catch(() => {});
    return Response.json(
      {
        error: "mail_failed",
        message:
          "The code could not be sent, so no code is live for this address. Try again in a " +
          "minute; if it keeps failing, this server's mail is broken.",
      },
      { status: 503, headers: { "Retry-After": "60" } },
    );
  }

  return accepted;
}

/** `14:32 UTC, 1 September` — enough to tell two identical mails apart,
 * without pretending to know the reader's timezone. The month is written in
 * the reader's own language (B857). */
function requestedAt(locale: string): string {
  const now = new Date();
  const time = now.toISOString().slice(11, 16);
  const day = now
    .toLocaleDateString(locale === "en" ? "en-GB" : locale, {
      day: "numeric",
      month: "long",
      timeZone: "UTC",
    })
    // Hungarian writes the day as "szeptember 7." — full stop included — and
    // the sentence this lands in ends with one of its own. Two in a row reads
    // like a typo in a mail whose whole job is to look trustworthy.
    .replace(/\.$/, "");
  return `${time} UTC, ${day}`;
}

/**
 * Whether this address may be sent an agent code for this journal.
 *
 * Two ways in. The journal's `owner.email` may write to all of it. Anyone in a
 * trip's `people:` block may write to that trip, and must name it in the
 * request — the code is one address plus one journal, so the trip has to be
 * stated before the token exists rather than chosen afterwards.
 */
async function mayRequestAgentToken(
  user: { username: string; owner: { email?: string } },
  tripId: string,
  email: string,
): Promise<boolean> {
  const address = email.trim().toLowerCase();
  // The instance admin owns every journal here (B480), so a code for any of
  // them is theirs to ask for on the same footing as the owner.
  const isOwnerOrAdmin = user.owner.email === address || isAdminEmail(address);
  if (!tripId) return isOwnerOrAdmin;
  // A trip named on the request has to exist in this journal — B241. Without
  // this, an owner's typo or not-yet-created trip id was still handed a code,
  // and the token minted from it (`write:trip:<typo>`) failed only later, at
  // every write, with a 404 that never said the trip was never real. Checked
  // once, ahead of both branches, so an owner naming a bad trip and a stranger
  // naming a real one they are not on get the identical `not_authorised`
  // above — neither answer says which was true.
  const trip = getTrip(tripRef(user.username, tripId));
  if (!trip) return false;
  // `isPersonOn` reads the trip's `people:` block **and** the buddy places the
  // owner has approved (B33), so somebody who joined by link asks for a token
  // through this same door rather than needing to be typed into a file first.
  return isOwnerOrAdmin || isPersonOn(trip, address);
}
