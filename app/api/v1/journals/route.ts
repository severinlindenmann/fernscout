import { SESSION_SCOPE, SIGNUP_OWNER, openAgentSession, resolveSession } from "@/lib/auth";
import { isEnabled } from "@/lib/capabilities";
import { createJournal } from "@/lib/journals";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { serverSite } from "@/lib/site";

export const dynamic = "force-dynamic";

/**
 * Create a journal.
 *
 * The step that used to be `mkdir` on somebody's server, which meant an agent
 * asked to "set up a travel blog" could get no further than explaining that it
 * could not. It takes the token from `/api/auth/signup/verify`, which proves
 * one thing only: whoever holds it can read the address the journal will be
 * owned by.
 *
 * It answers with an **agent token for the journal it just made**, so the
 * caller can go straight on to creating a trip and writing days. Without that
 * the flow would end by telling the agent to go and ask for another code.
 */
export async function POST(request: Request) {
  if (!isEnabled("signup")) {
    return Response.json({ error: "signup_disabled" }, { status: 404 });
  }

  const limit = rateLimitFor("journals-create", clientIp(request), {
    max: 5,
    windowMs: 60 * 60 * 1000,
  });
  if (!limit.ok) {
    return Response.json(
      { error: "too_many_requests", retryAfter: limit.retryAfter },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return Response.json(
      { error: "missing_token", message: "Start at POST /api/auth/signup/request." },
      { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="fernscout"' } },
    );
  }

  // Only a signup session reaches this. An agent token for an existing journal
  // is refused here rather than quietly allowed to make more: the address
  // behind it was verified for *that* journal, and a token that can mint
  // journals should have been issued for the purpose.
  const session = await resolveSession(match[1].trim(), "signup");
  if (!session || session.owner !== SIGNUP_OWNER) {
    return Response.json({ error: "invalid_token" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const str = (key: string): string | undefined =>
    typeof body[key] === "string" ? (body[key] as string) : undefined;
  const list = (key: string): string[] | undefined =>
    Array.isArray(body[key]) ? (body[key] as unknown[]).filter((v): v is string => typeof v === "string") : undefined;

  const username = str("username") ?? "";
  const title = str("title") ?? "";
  const ownerName = str("ownerName") ?? "";
  const ownerNickname = str("ownerNickname") ?? "";
  if (!username || !title || !ownerName || !ownerNickname) {
    return Response.json(
      {
        error: "invalid_request",
        message:
          'A journal needs at least {"username": "…", "title": "…", "ownerName": "…", ' +
          '"ownerNickname": "…"}.',
      },
      { status: 400 },
    );
  }

  const created = createJournal({
    username,
    title,
    tagline: str("tagline"),
    ownerEmail: session.email,
    ownerName,
    ownerNickname,
    startLocation: str("startLocation"),
    defaultLocale: str("defaultLocale"),
    locales: list("locales"),
    baseCurrency: str("baseCurrency"),
    displayCurrencies: list("displayCurrencies"),
    units: str("units") === "imperial" ? "imperial" : "metric",
  });

  if (!created.ok) {
    // 409 for "that name is taken", 400 for "that name is not a name".
    const status = created.error === "username_taken" ? 409 : created.error === "too_many_journals" ? 403 : 400;
    return Response.json({ error: created.error, message: created.message }, { status });
  }

  const token = await openAgentSession(created.username, session.email);

  return Response.json(
    {
      ok: true,
      user: created.username,
      url: `${serverSite().url}/${created.username}`,
      documentation: `${serverSite().url}/${created.username}/documentation.txt`,
      token: token.token,
      expires: token.expiresAt,
      scope: [SESSION_SCOPE.agent],
      next: `POST /api/v1/${created.username}/trips to create your first trip.`,
    },
    { status: 201 },
  );
}
