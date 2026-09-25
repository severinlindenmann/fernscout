import { adminEmail } from "@/lib/admin";
import { isInstanceAdmin } from "@/lib/adminGate";
import { ack, endAck, listAcks } from "@/lib/adminAcks";
import { attention, health, snapshot, troubles } from "@/lib/adminConsole";
import { loadServerConfig } from "@/lib/config";
import { dashboard } from "@/lib/instanceCosts";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/** How long a snooze holds. One day: "not today" is the only thing it says. */
const SNOOZE_MS = 24 * 60 * 60 * 1000;

/**
 * The operator says they already know — B1203.
 *
 * **It hides and it fixes nothing.** Acknowledging an entry of `/admin`'s
 * attention band records that somebody has seen it at the size it is now; the
 * backup is still stale, the disk is still nearly full, and the purchase is
 * still waiting. `lib/adminAcks.ts` is where the rule lives, and the half of
 * it that matters here is that an acknowledgement lapses the moment the thing
 * gets worse.
 *
 * **The level is measured, never sent.** The request names an id and nothing
 * else; this route rebuilds the band and takes the level off the entry it
 * finds. A caller that could state its own level could file "already at its
 * worst" and silence something for ever, which is the one way this feature
 * could be turned into a way of not being told.
 *
 * That also means an id nothing is currently raising cannot be acknowledged at
 * all — there is nothing to acknowledge — and says so rather than writing a
 * row that would suppress the entry the first time it appears.
 *
 * **Snooze is an acknowledgement with a clock**. `action: "snooze"`
 * files the same row with `until` a day ahead; it still lapses the moment the
 * entry gets worse, and also when the day is up. The length is fixed here,
 * not sent, for the same reason the level is not: a caller that could name
 * its own `until` could snooze an alarm for a decade.
 *
 * Outside `/api/v1/` deliberately, like `/api/web/admin/grants`: it takes the
 * operator's cookie only, there is no bearer-token path to it, and to anybody
 * who is not the operator this route does not exist.
 */
export async function POST(request: Request) {
  if (!(await isInstanceAdmin())) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const limit = rateLimitFor("admin-ack", clientIp(request), { max: 60, windowMs: 60 * 1000 });
  if (!limit.ok) {
    return Response.json(
      { error: "too_many_requests", retryAfter: limit.retryAfter },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const id = typeof body.id === "string" ? body.id.trim() : "";
  const action =
    body.action === "unhide" ? "unhide" : body.action === "snooze" ? "snooze" : "acknowledge";
  if (!id) return Response.json({ error: "id_required" }, { status: 400 });

  if (action === "unhide") {
    await endAck(id, "unhidden");
    return Response.json({ ok: true, id, action });
  }

  const entry = (await band()).find((one) => one.id === id);
  if (!entry) {
    // Nothing is raising this. Writing the row anyway would suppress the entry
    // the first time it ever appears, which is the opposite of what pressing
    // acknowledge on something you can see means.
    return Response.json({ error: "not_raised" }, { status: 404 });
  }

  const now = new Date();
  const until = action === "snooze" ? new Date(now.getTime() + SNOOZE_MS) : undefined;
  await ack(entry, adminEmail() ?? "", now, until);
  return Response.json({
    ok: true,
    id,
    action,
    level: entry.level,
    ...(until ? { until: until.toISOString() } : {}),
  });
}

/** Everything the band would show right now, before any suppression.
 *
 *  The same four reads the page makes, which is the cost of measuring a level
 *  rather than believing one. It is one press by one person, so the duplicated
 *  work is cheaper than the class of bug the alternative opens. */
async function band() {
  const [data, { report }, healthNow, troubleRows] = await Promise.all([
    dashboard(new Date(Date.now() - 30 * 86_400_000).toISOString()),
    snapshot(),
    health(),
    troubles(new Date(Date.now() - 30 * 86_400_000).toISOString()),
  ]);
  return attention({
    awaiting: data.awaiting,
    health: healthNow,
    troubles: troubleRows,
    journals: report.journals,
    ceiling: loadServerConfig().media.perUserBytes,
    balances: data.journals,
  });
}

/** The history, for a page that wants it without a reload. */
export async function GET() {
  if (!(await isInstanceAdmin())) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  return Response.json({ acks: await listAcks() });
}
