import { isEmail } from "@/lib/auth";
import { isEnabled } from "@/lib/capabilities";
import { fromAcceptLanguage, pickLocale } from "@/lib/contacts/locale";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { sendSignupCode } from "@/lib/signupCode";

export const dynamic = "force-dynamic";

/**
 * Step one of making a journal: prove you can read an address.
 *
 * Unlike `/api/auth/request` this names no journal, because the whole point is
 * that none exists yet. The code is filed under `NO_JOURNAL`, which is not a
 * username and cannot become one, so the session it eventually produces can
 * never satisfy `ownsUser` for a real journal — it can create one and nothing
 * else.
 *
 * 202 for everything, and here the usual reasoning holds without qualification:
 * a signup endpoint that said "that address already has journals" would be a
 * way to ask who is on this server.
 */
export async function POST(request: Request) {
  if (!isEnabled("signup")) {
    return Response.json({ error: "signup_disabled" }, { status: 404 });
  }
  if (!isEnabled("mail")) {
    // Refused rather than accepted-and-silent: with no mail there is no way to
    // finish, and a 202 would promise a code that cannot be sent.
    return Response.json(
      {
        error: "mail_disabled",
        message: "This server cannot send the code that signing up needs.",
      },
      { status: 503 },
    );
  }

  const limit = rateLimitFor("auth-signup", clientIp(request), {
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
      next: "POST /api/auth/signup/verify with {\"email\", \"code\"} to get a token that can create one journal.",
    },
    { status: 202 },
  );
  if (!isEmail(email)) return accepted;

  /**
   * The language the request asked for — B857.
   *
   * There is no journal yet and no contact record, so `accept-language` is the
   * only thing that says anything about the reader, and English is what is
   * left when it says nothing this instance speaks. It is the first mail this
   * software ever sends anybody: a Hungarian speaker who cannot read it never
   * reaches the journal the rest of the product is good at.
   */
  const locale = pickLocale(fromAcceptLanguage(request.headers.get("accept-language")));

  /**
   * Issued and sent by `lib/signupCode.ts` — including the invariant that
   * used to be written out here: a failed send revokes the code it could not
   * deliver, so at most one live code exists per address and it is the one
   * that was actually sent. Lifted out by B1363, which gave signup a second
   * door (WhatsApp) that has to mail the identical letter.
   */
  if (!(await sendSignupCode(email, locale))) {
    return Response.json(
      {
        error: "mail_failed",
        message:
          "The code could not be sent, so no code is live for this address. Nothing has been " +
          "created. Try again in a minute; if it keeps failing, this server's mail is broken " +
          "and the person who runs it has to fix it.",
      },
      { status: 503, headers: { "Retry-After": "60" } },
    );
  }

  return accepted;
}

