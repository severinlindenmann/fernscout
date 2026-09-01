import { SIGNUP_OWNER, isEmail, issueCode, revokeCodes } from "@/lib/auth";
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

  /**
   * The send is guarded, and a failure takes the code back with it.
   *
   * Unguarded, an SMTP hiccup became an unhandled throw and a framework 500
   * with an empty body — not in the error table, indistinguishable from "stop"
   * and from "try again". Worse than the status was what it left behind: the
   * code is written to the database *before* the mail goes out, and issuing
   * one consumes every earlier one. So a failed attempt silently killed the
   * code the person may still have had in their inbox, and left a live code
   * nobody had ever been told. That is how a run ends with `invalid_code` on a
   * code somebody read out correctly.
   *
   * Revoking here restores the invariant: at most one live code per address,
   * and it is the one that was actually sent.
   */
  try {
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
          // The timestamp is what makes two identical mails tellable apart.
          // Asking again invalidates the earlier code and sends a mail that is
          // word for word the same, so without a stamp the person reads out
          // whichever is nearest and gets `invalid_code` for their trouble.
          {
            kind: "paragraph",
            text:
              `Asked for at ${requestedAt()}. If you have an older mail like this one, ` +
              "its code no longer works — the newest is the only live one.",
          },
          {
            kind: "paragraph",
            text: "If you did not ask for this, ignore it — nothing has been created.",
          },
        ],
        footer: `Sent by ${serverSite().name}.`,
      }),
    );
  } catch (err) {
    console.error("[auth] signup code could not be sent:", err);
    await revokeCodes(SIGNUP_OWNER, email, "signup").catch(() => {});
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

/** `14:32 UTC on 1 September` — enough to tell two identical mails apart,
 * without pretending to know the reader's timezone. */
function requestedAt(): string {
  const now = new Date();
  const time = now.toISOString().slice(11, 16);
  const day = now.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
  return `${time} UTC on ${day}`;
}
