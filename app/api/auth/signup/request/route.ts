import { SIGNUP_OWNER, isEmail, issueCode } from "@/lib/auth";
import { isEnabled } from "@/lib/capabilities";
import { sendMail } from "@/lib/mail";
import { renderMail } from "@/lib/mail/template";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { serverSite } from "@/lib/site";

export const dynamic = "force-dynamic";

/**
 * Step one of making a journal: prove you can read an address.
 *
 * Unlike `/api/auth/request` this names no journal, because the whole point is
 * that none exists yet. The code is filed under `SIGNUP_OWNER`, which is not a
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

  const { code } = await issueCode(SIGNUP_OWNER, email, "signup");

  await sendMail(
    renderMail(email, `Your code to start a journal on ${serverSite().name}`, {
      preheader: `Your code is ${code}`,
      title: "Start a journal",
      blocks: [
        { kind: "paragraph", text: `Your code is ${code}. It works for ten minutes.` },
        {
          kind: "paragraph",
          text:
            "Somebody — probably an agent working for you — asked to create a travel journal " +
            "at this address. Give it this code and it can create one journal, once.",
        },
        {
          kind: "paragraph",
          text: "If you did not ask for this, ignore it — nothing has been created.",
        },
      ],
      footer: `Sent by ${serverSite().name}.`,
    }),
  );

  return accepted;
}
