import { resolveCapabilities } from "@/lib/capabilities";
import { isOwner } from "@/lib/contacts/session";
import { setJournalFeatures } from "@/lib/journals";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

/**
 * The two switches that decide whether a published day spends anything — B463.
 *
 * ## Why this exists next to a balance and not as a settings page
 *
 * `PATCH /api/v1/<user>/config` already writes `features`, and its own comment
 * says there is no settings page and will not be one. This is not that: it is
 * two capabilities, the two that spend the balance the credits card is about,
 * reachable by the person already signed in as the owner and looking at that
 * balance going down. Nothing else about the journal is writable here — the
 * body names a channel from `CHANNELS` or it is refused — so this cannot grow
 * into the surface that comment is against without someone widening this
 * constant on purpose.
 *
 * `setJournalFeatures` does the work, so the two properties that matter are
 * the ones that already exist rather than a second implementation: the server
 * is a ceiling that a journal can never write past, and the file is read back
 * after the write and restored if it no longer parses.
 *
 * ## Muting mail cannot lock anybody out
 *
 * `features.mail: false` is B60's mute button and stops day letters and
 * digests. It does not stop a sign-in code, a deletion confirmation or a
 * purchase receipt: those go through `sendTransactional`, which is
 * deliberately not suppressible by a journal's own mail switch. An owner can
 * therefore always mute the channel they are paying for and still sign in
 * tomorrow.
 *
 * Owner only, by the same `isOwner(user, request)` gate
 * `credits/purchase` uses — cookie or an owner-scoped token, never a
 * trip-scoped one.
 */
const CHANNELS = ["mail", "whatsapp"] as const;
type Channel = (typeof CHANNELS)[number];

export async function POST(
  request: Request,
  { params }: RouteContext<"/api/v1/[user]/channels">,
) {
  const { user } = await params;
  if (!getUser(user)) {
    return Response.json({ error: "no_such_journal" }, { status: 404 });
  }

  if (!(await isOwner(user, request))) {
    return Response.json(
      {
        error: "forbidden",
        message:
          "Only the address that owns this journal may switch its sending channels — " +
          "not a guest, and not a token scoped to one of its trips.",
      },
      { status: 403 },
    );
  }

  // Owner-only already, so this is a stuck client rather than an attacker.
  // The same shape `credits/purchase` uses.
  const limit = rateLimitFor("journal-channels", clientIp(request), {
    max: 20,
    windowMs: 60 * 1000,
  });
  if (!limit.ok) {
    return Response.json(
      { error: "too_many_requests", retryAfter: limit.retryAfter },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const channel = CHANNELS.find((name) => name === body.channel);
  if (!channel || typeof body.enabled !== "boolean") {
    return Response.json(
      {
        error: "bad_request",
        message: `Send {"channel": "${CHANNELS.join('" | "')}", "enabled": true | false}.`,
      },
      { status: 400 },
    );
  }

  const result = setJournalFeatures(user, { [channel]: body.enabled });
  if (!result.ok) {
    // `capability_unavailable` is the server ceiling refusing to be widened,
    // which is a 409 rather than a 400: the request was well formed and the
    // answer is about this server, not about what was asked.
    return Response.json(result, {
      status: result.error === "capability_unavailable" ? 409 : 400,
    });
  }

  const server = resolveCapabilities();
  return Response.json({
    ok: true,
    channels: Object.fromEntries(
      CHANNELS.map((name: Channel) => [
        name,
        // `null` where the server does not offer it at all — the same shape
        // the page renders from, so a switch that cannot exist never comes
        // back as a confident `false`.
        server[name].enabled ? result.features[name] : null,
      ]),
    ),
  });
}
