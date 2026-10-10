import { cookies } from "next/headers";
import { countInviteUse } from "@/lib/contacts/invites";
import { FOREIGN_ORIGIN_REFUSAL, foreignOrigin } from "@/lib/auth/originCheck";
import { journalPath } from "@/lib/journalPath";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { LINK_COOKIE, LINK_COOKIE_MAX_AGE_S, linkCookieValue, openTokenValid, resolveReadCode } from "@/lib/tripLink";

export const dynamic = "force-dynamic";

const PER_IP = { max: 40, windowMs: 15 * 60 * 1000 };
const PER_CODE = { max: 200, windowMs: 60 * 60 * 1000 };
const NO = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } as const;
const refuse = (body: unknown, status: number) => Response.json(body, { status, headers: NO });

/**
 * `POST /t/<code>/open` — the press on the landing page (B2961). Stores the
 * link in an HttpOnly cookie, counts the use and sends the reader to the
 * trip's own address.
 *
 * Two guards, because `SameSite=Lax` alone is not enough here: the form's CSRF
 * token (`openTokenValid`), and a **strict** Origin — `foreignOrigin` lets a
 * missing header through, which a one-click navigation from another site must
 * not get. The per-code limit slows presses only; a cookie holder never goes
 * through this route to keep reading, so it cannot lock a family out.
 */
export async function POST(request: Request, { params }: RouteContext<"/t/[code]/open">) {
  if (!request.headers.get("origin") || foreignOrigin(request)) return refuse(FOREIGN_ORIGIN_REFUSAL, 403);
  const { code } = await params;
  const form = await request.formData().catch(() => null);
  if (!openTokenValid(code, form?.get("token"))) return refuse({ error: "bad_token" }, 403);
  if (!rateLimitFor("trip-link-open-ip", clientIp(request), PER_IP).ok || !rateLimitFor("trip-link-open-code", code, PER_CODE).ok) {
    return refuse({ error: "rate_limited" }, 429);
  }

  const link = await resolveReadCode(code);
  if (!link) return refuse({ error: "not_found" }, 404);

  (await cookies()).set(LINK_COOKIE, linkCookieValue(link.inviteId, code), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: LINK_COOKIE_MAX_AGE_S,
  });
  await countInviteUse(link.owner, link.inviteId);

  return new Response(null, {
    status: 303,
    headers: { ...NO, Location: `${journalPath(link.owner)}/trips/${link.trip.id}` },
  });
}
