import { cookies } from "next/headers";
import { readJsonBody } from "@/lib/api/jsonBody";
import { FOREIGN_ORIGIN_REFUSAL, foreignOrigin } from "@/lib/auth/originCheck";
import { issueIdentityCookie } from "@/lib/auth/identityCookie";
import { isEnabled } from "@/lib/capabilities";
import { joinWhatsappAvailable, typedDigits } from "@/lib/contacts/guestPhone";
import { parseLocale } from "@/lib/contacts/locale";
import { phoneSubject } from "@/lib/phone";
import { SIGNIN_SCOPE, createJoinPhoneLink, pollJoinPhoneLink } from "@/lib/phoneVerify/inboundLink";
import { clientIp, waJoinAllowed } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

const WA_COOKIE = "fs_wa_signin";
const NO = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } as const;
const answer = (body: unknown, status = 200) => Response.json(body, { status, headers: NO });

/**
 * `POST /me/wa` — sign in by sending a WhatsApp message (B-3003).
 *
 * The server-wide identity door, the WhatsApp twin of the texted code: the
 * person types their number, taps a wa.me link and sends the message it
 * carries; the webhook seeing that token arrive from the number is the proof.
 * The row is bound to a secret only this browser holds (httpOnly cookie), and
 * to the number typed, so nobody else can collect the proof and a message from
 * any other number is a mismatch.
 *
 * What it leaves is an identity for that number and nothing else: no
 * contact's phone is marked proven (a server-wide sign-in proves nothing to
 * a journal) and a number nobody holds just sees "Nothing yet".
 *
 * - `start` `{ phone, locale }` — the link to open.
 * - `poll` `{ id }` — `pending`, `mismatch`, `expired`, or `in` (cookie set).
 */
export async function POST(request: Request) {
  if (foreignOrigin(request)) return answer(FOREIGN_ORIGIN_REFUSAL, 403);
  if (!isEnabled("auth")) return answer({ error: "unavailable" }, 404);
  if (!joinWhatsappAvailable()) return answer({ error: "unavailable" }, 404);
  const jsonBody = await readJsonBody(request);
  if (!jsonBody.ok) return jsonBody.response;
  const body = (jsonBody.value ?? {}) as Record<string, unknown>;
  const text = (key: string) => (typeof body[key] === "string" ? (body[key] as string).trim() : "");
  const jar = await cookies();

  if (body.action === "start") {
    const digits = typedDigits(text("phone"));
    if (!digits) return answer({ error: "invalid_phone" }, 400);
    if (!waJoinAllowed(digits, clientIp(request), SIGNIN_SCOPE)) return answer({ error: "rate_limited" }, 429);
    const locale = parseLocale(text("locale")) ?? "en";
    const created = await createJoinPhoneLink(SIGNIN_SCOPE, digits, locale, jar.get(WA_COOKIE)?.value ?? null);
    if (!created) return answer({ error: "unavailable" }, 404);
    jar.set(WA_COOKIE, created.secret, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/me/wa",
      maxAge: 30 * 60,
    });
    return answer({ ok: true, id: created.id, link: created.link, expiresAt: created.expiresAt });
  }

  if (body.action === "poll") {
    const id = text("id");
    const secret = jar.get(WA_COOKIE)?.value;
    if (!id || !secret) return answer({ status: "expired" });
    const polled = await pollJoinPhoneLink(id, SIGNIN_SCOPE, secret);
    if (polled.status !== "ok") return answer({ status: polled.status });
    await issueIdentityCookie(phoneSubject(polled.phone), request.headers.get("user-agent"));
    jar.delete({ name: WA_COOKIE, path: "/me/wa" });
    return answer({ ok: true, status: "in" });
  }

  return answer({ error: "invalid_request" }, 400);
}
