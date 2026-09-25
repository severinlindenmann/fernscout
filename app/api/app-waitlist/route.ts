import { addToWaitlist, iosAppStoreUrl, iosAppWaitlistAvailable, isValidWaitlistEmail } from "@/lib/appWaitlist";
import { isEnabled } from "@/lib/capabilities";
import { clientIp, emailCodeAllowed, rateLimitFor } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/**
 * Join the iPhone app's waitlist — B2341.
 *
 * Public and unauthenticated, like the mailed-code doors in
 * `/api/auth/codes`: a visitor has no journal and no session yet. The whole
 * capability is absent, not broken, when it cannot actually do anything —
 * `iosApp` off, or on with no store link and no working waitlist — so this
 * answers `404` in exactly the cases the landing page renders nothing,
 * which is also what keeps a stranger from learning the difference between
 * "not configured" and "configured but broken" by probing the route
 * directly rather than reading the page.
 *
 * **No enumeration.** Every outcome that depends on the address — new,
 * already on the list, or rate-limited — answers the same 202 with the same
 * body. Only a malformed request (not an email at all) is told so, the same
 * split `POST /api/auth/codes` makes.
 */
export async function POST(request: Request) {
  if (!isEnabled("iosApp") || iosAppStoreUrl() || !iosAppWaitlistAvailable()) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const locale = typeof body.locale === "string" ? body.locale.trim() : undefined;
  if (!isValidWaitlistEmail(email)) {
    return Response.json(
      { error: "invalid_email", message: "That is not an email address." },
      { status: 400 },
    );
  }

  const accepted = () => Response.json({ ok: true });

  const ip = clientIp(request);
  const perIp = rateLimitFor("app-waitlist-ip", ip, { max: 20, windowMs: 60 * 60 * 1000 });
  if (!perIp.ok) return accepted();
  // Reuses the same per-address/per-instance mailed-code ceiling as every
  // other door that sends a letter to an address a caller supplied — this
  // is one more.
  if (!emailCodeAllowed(email)) return accepted();

  await addToWaitlist(email, locale).catch((err) => {
    console.error("[app-waitlist] could not record an entry:", err);
  });
  return accepted();
}
