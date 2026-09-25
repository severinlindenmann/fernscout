import { isInstanceAdmin } from "@/lib/adminGate";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { clearTombstone, journalTombstone } from "@/lib/tombstones";

export const dynamic = "force-dynamic";

/**
 * The operator hands a deleted journal's name back — B1354.
 *
 * A tombstone is what keeps a deleted journal's name from being handed to the
 * next person who types it: `isDeletedUsername` refuses the signup and `proxy.ts` answers 410
 * on every old URL. That is right by default and wrong in exactly one case —
 * the person who deleted the journal wants their own name back — and until now
 * the only way to say so was `rm content/.deleted/<name>.json` on the server,
 * which the operator of a hosted instance has and nobody else does.
 *
 * **It frees a name; it restores nothing.** The content is gone, and this
 * cannot bring it back — the only thing it changes is that the name is
 * available again, to whoever signs up next. So it is the operator's call and
 * not an owner's: the address that asked for the deletion has no way to prove,
 * an hour or a year later, that nobody else is waiting for that name.
 *
 * Cookie-only and 404 to everybody else, the same shape as the refund route
 * beside it. Lowering a barrier rather than raising a balance, so no mailed
 * second step: the worst it does is make a name claimable, and the tombstone
 * is rewritten by the next deletion anyway.
 */
export async function POST(request: Request) {
  if (!(await isInstanceAdmin())) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const limit = rateLimitFor("admin-tombstone", clientIp(request), { max: 20, windowMs: 60 * 1000 });
  if (!limit.ok) {
    return Response.json(
      { error: "too_many_requests", retryAfter: limit.retryAfter },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const username = typeof body.user === "string" ? body.user : "";
  // Nothing checks for a live journal of the same name, because there cannot
  // be one: `isReservedUsername` counts a tombstone as taken, so `getUsernames`
  // skips the directory while the record exists, and `createJournal` clears the
  // record the moment somebody reclaims the name. A tombstone means the name is
  // held; that is the whole state.
  const stone = journalTombstone(username);
  if (!stone) {
    return Response.json(
      { error: "no_tombstone", message: `No deleted journal called "${username}".` },
      { status: 404 },
    );
  }

  clearTombstone(username);
  return Response.json({ ok: true, released: username, title: stone.title });
}
