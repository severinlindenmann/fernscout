import {
  CODE_TTL_MINUTES,
  NO_JOURNAL,
  identitySignInUrl,
  isEmail,
  issueCode,
  revokeCodes,
} from "@/lib/auth";
import { isEnabled } from "@/lib/capabilities";
import { requestLocale, translateIn } from "@/lib/locales";
import { sendMail } from "@/lib/mail";
import { renderMail } from "@/lib/mail/template";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { serverSite } from "@/lib/site";

export const dynamic = "force-dynamic";

/**
 * Step one of proving an address to the whole instance — B410.
 *
 * Like `/api/auth/signup/request`, this names no journal: the code is filed
 * under `NO_JOURNAL` because the address is not being proved *for* anything
 * in particular. Unlike signup, what it produces creates nothing and opens
 * nothing. It says "this address is yours", and every journal on the instance
 * then decides for itself what that is worth — which for most addresses and
 * most journals is nothing at all.
 *
 * That is why this is safe to leave open to any address, where signup is
 * gated: an identity for an address with no grants anywhere is a credential
 * that can read one page listing zero journals.
 *
 * 202 for everything, for the reason every code endpoint here does it: an
 * answer that distinguished "no such address" from "sent" is a way to ask who
 * reads this server.
 */
export async function POST(request: Request) {
  if (!isEnabled("auth")) {
    return Response.json({ error: "auth_disabled" }, { status: 404 });
  }
  if (!isEnabled("mail")) {
    // Refused rather than accepted-and-silent: with no mail there is no way to
    // finish, and a 202 would promise a code that cannot be sent.
    return Response.json(
      {
        error: "mail_disabled",
        message: "This server cannot send the code that signing in needs.",
      },
      { status: 503 },
    );
  }

  const limit = rateLimitFor("auth-identity", clientIp(request), {
    max: 5,
    windowMs: 60 * 60 * 1000,
  });
  if (!limit.ok) {
    return Response.json(
      { error: "too_many_requests", retryAfter: limit.retryAfter },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const email = typeof body.email === "string" ? body.email : "";

  const accepted = Response.json(
    {
      status: "accepted",
      next: 'POST /api/auth/identity/verify with {"email", "code"} to sign in on this device.',
    },
    { status: 202 },
  );
  if (!isEmail(email)) return accepted;

  const { code, linkToken } = await issueCode(NO_JOURNAL, email, "identity");

  /**
   * The language the reader chose on the site, not the server's default —
   * B430.
   *
   * `requestLocale()` reads the cookie `proxy.ts` writes from `?lang=` and the
   * language switcher sets, so the mail arrives in the language the page was
   * in when they asked for it. There is nowhere else to get it from: an
   * identity belongs to no journal, so there is no `user.locales` to narrow
   * against and no contact record carrying a `locale` — this address may be
   * one this instance has never seen.
   */
  const locale = await requestLocale();
  const site = serverSite();
  const vars = { site: site.name, code, minutes: CODE_TTL_MINUTES };

  /**
   * Guarded, and a failure takes the code back with it — the same shape as the
   * signup route, for the same reason written out at length there: issuing a
   * code consumes every earlier one, so an unguarded send failure kills the
   * code the person may still be holding and leaves a live one nobody was told.
   */
  try {
    await sendMail(
      renderMail(email, translateIn(locale, "mail.identitySubject", vars), {
        preheader: translateIn(locale, "mail.identityCode", vars),
        title: translateIn(locale, "mail.identityTitle"),
        blocks: [
          // The code first, and it stays first. On iOS a home-screen web app
          // has its own storage container, so the button below signs somebody
          // in *in Safari* and leaves the installed app signed out — looking
          // like it worked. The code is the only thing that works everywhere.
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
    await revokeCodes(NO_JOURNAL, email, "identity").catch(() => {});
    return Response.json(
      {
        error: "mail_failed",
        message:
          "The code could not be sent, so no code is live for this address. Try again in a " +
          "minute; if it keeps failing, this server's mail is broken and the person who runs " +
          "it has to fix it.",
      },
      { status: 502 },
    );
  }

  return accepted;
}
