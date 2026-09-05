import { CODE_TTL_MINUTES, NO_JOURNAL, isEmail, issueCode, revokeCodes } from "@/lib/auth";
import { isEnabled } from "@/lib/capabilities";
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

  const { code } = await issueCode(NO_JOURNAL, email, "identity");

  /**
   * Guarded, and a failure takes the code back with it — the same shape as the
   * signup route, for the same reason written out at length there: issuing a
   * code consumes every earlier one, so an unguarded send failure kills the
   * code the person may still be holding and leaves a live one nobody was told.
   */
  try {
    await sendMail(
      renderMail(email, `Your code for ${serverSite().name}`, {
        preheader: `Your code is ${code}`,
        title: "Sign in",
        blocks: [
          {
            kind: "paragraph",
            text: `Your code is ${code}. It works for ${CODE_TTL_MINUTES} minutes.`,
          },
          {
            kind: "paragraph",
            text:
              "Signing in shows you the journals on this server you have been let into, in one " +
              "place. It does not by itself give you access to anything — each journal still " +
              "decides, and you will only see what its owner has already shared with you.",
          },
          {
            kind: "paragraph",
            text:
              "It lasts a year, on this device. You can end it any time from the page it signs " +
              "you in to.",
          },
          {
            kind: "paragraph",
            text: "If you did not ask for this, ignore it — nothing has been opened.",
          },
        ],
        footer: `Sent by ${serverSite().name}.`,
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
