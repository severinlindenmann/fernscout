import {
  addInviteRequest,
  inviteRequestAvailable,
  isValidInviteRequestEmail,
} from "@/lib/inviteRequest";
import { clientIp, emailCodeAllowed, rateLimitFor } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/**
 * A stranger asking to be let in — B2507.
 *
 * Public and unauthenticated, like `/api/app-waitlist` (B2341) and the
 * mailed-code doors in `/api/auth/codes`. The capability is absent, not
 * broken, when it cannot do anything — the instance is not invite-only, or
 * it is but has no working mail/db — so this answers `404` in exactly the
 * cases `/invite`'s own page 404s, which keeps a caller from learning
 * "not invite-only" from "invite-only but broken" by probing the route
 * directly.
 *
 * **No enumeration.** Every outcome that depends on the address — new,
 * already requested, or already invited — answers the same 200 with the
 * same body. Only a malformed request is told so.
 */
export async function POST(request: Request) {
  if (!inviteRequestAvailable()) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const locale = typeof body.locale === "string" ? body.locale.trim() : undefined;
  if (!isValidInviteRequestEmail(email)) {
    return Response.json(
      { error: "invalid_email", message: "That is not an email address." },
      { status: 400 },
    );
  }

  const accepted = () => Response.json({ ok: true });

  const ip = clientIp(request);
  const perIp = rateLimitFor("invite-request-ip", ip, { max: 20, windowMs: 60 * 60 * 1000 });
  if (!perIp.ok) return accepted();
  // Same per-address ceiling every other door that mails an address a
  // caller supplied reuses (see lib/appWaitlist.ts).
  if (!emailCodeAllowed(email)) return accepted();

  await addInviteRequest(email, locale).catch((err) => {
    console.error("[invite-request] could not record a request:", err);
  });
  return accepted();
}
