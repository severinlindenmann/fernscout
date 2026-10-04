import { isInstanceAdmin } from "@/lib/adminGate";
import { FOREIGN_ORIGIN_REFUSAL, foreignOrigin } from "@/lib/auth/originCheck";
import { clearOwnerTel, getOwnerTel } from "@/lib/ownerTel";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { USERNAME_RE, getUser } from "@/lib/users";
import { readJsonBody } from "@/lib/api/jsonBody";

export const dynamic = "force-dynamic";

/**
 * The operator frees one journal's proven phone number — B2833.
 *
 * A journal's number is locked to it (one journal per number). Only the
 * operator may lift that lock: an owner or an agent token cannot, because a
 * number held by a journal is how a stranger is kept from claiming somebody
 * else's WhatsApp channel, and "I want my number back" is a request the
 * operator checks, not a button. `DELETE /api/v2/{user}/owner/tel` answers 403.
 *
 * Cookie-only and 404 to everybody else, like the other `/api/admin/*` routes;
 * a bearer header is refused outright and a foreign Origin is refused.
 * **The number never leaves the server**: the answer carries only the last two
 * digits, so a screenshot of the panel does not carry anybody's number.
 *
 * GET ?user=<name> shows what is bound; POST {user} frees it.
 */
async function gate(request: Request, mutating: boolean): Promise<Response | null> {
  if (request.headers.get("authorization") || !(await isInstanceAdmin())) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  if (mutating && foreignOrigin(request)) return Response.json(FOREIGN_ORIGIN_REFUSAL, { status: 403 });
  const limit = rateLimitFor("admin-owner-tel", clientIp(request), { max: 30, windowMs: 60 * 1000 });
  if (!limit.ok) {
    return Response.json(
      { error: "too_many_requests", retryAfter: limit.retryAfter },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }
  return null;
}

/** The last two digits, nothing else. */
async function boundMask(username: string): Promise<string | null> {
  const tel = (await getOwnerTel(username))?.tel ?? getUser(username)?.owner?.tel ?? null;
  const digits = tel?.replace(/\D/g, "") ?? "";
  return digits ? `${"•".repeat(Math.max(digits.length - 2, 0))}${digits.slice(-2)}` : null;
}

const noJournal = (username: string) =>
  Response.json({ error: "no_journal", message: `No journal called "${username}".` }, { status: 404 });

export async function GET(request: Request) {
  const refused = await gate(request, false);
  if (refused) return refused;
  const username = (new URL(request.url).searchParams.get("user") ?? "").trim();
  if (!USERNAME_RE.test(username) || !getUser(username)) return noJournal(username);
  return Response.json({ user: username, masked: await boundMask(username) });
}

export async function POST(request: Request) {
  const refused = await gate(request, true);
  if (refused) return refused;
  const bodyRead = await readJsonBody(request);
  if (!bodyRead.ok) return bodyRead.response;
  const body = (bodyRead.value ?? {}) as Record<string, unknown>;
  const username = typeof body.user === "string" ? body.user.trim() : "";
  if (!USERNAME_RE.test(username) || !getUser(username)) return noJournal(username);

  const masked = await boundMask(username);
  if (!masked) return Response.json({ ok: true, freed: false, user: username });
  await clearOwnerTel(username);
  return Response.json({ ok: true, freed: true, user: username, masked });
}
