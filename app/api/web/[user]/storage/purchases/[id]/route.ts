// Buy this journal five more gigabytes — B1622, phase 2 step 4 (money.md
// §2.6), replacing the POST half of app/api/v1/[user]/storage/route.ts.
// Owner cookie ONLY — a bearer token is refused outright, `not_for_agents`,
// unchanged from v1 and deliberately kept: this spends the owner's existing
// balance immediately, for disk rather than for reaching anyone, so it is
// never an agent's to trigger even on instruction.
//
// Client-chosen id (money.md §2.6): a retried PUT with the same id is a
// no-op re-read rather than a second spend — `ledgerHasRef` is the check,
// folding the id into the ledger row's own `ref` rather than adding a table.
import { creditsEnabled, ledgerHasRef, spend } from "@/lib/credits";
import { EXTRA_STORAGE_BYTES, EXTRA_STORAGE_CREDITS, creditsInRappen, formatChf } from "@/lib/credits/pricing";
import { isOwner } from "@/lib/contacts/session";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { formatBytes, storageFor } from "@/lib/storageQuota";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

export async function PUT(
  request: Request,
  { params }: RouteContext<"/api/web/[user]/storage/purchases/[id]">,
) {
  const { user, id } = await params;

  const journal = getUser(user);
  if (!journal || !creditsEnabled()) {
    return Response.json(
      { error: "credits_disabled", message: "This server does not charge for storage, so there is nothing to buy." },
      { status: 404 },
    );
  }

  if (request.headers.get("authorization")) {
    return Response.json(
      {
        error: "not_for_agents",
        message:
          "Buying storage spends the owner's credits and is done by the owner, from their " +
          "own page. Nothing has been charged. Tell them the journal is full and let them " +
          "decide whether to delete something or buy more room.",
      },
      { status: 403 },
    );
  }

  if (!(await isOwner(user, request))) {
    return Response.json(
      {
        error: "forbidden",
        message: "Only the address that owns this journal may buy storage for it — not a guest, and not a token scoped to one of its trips.",
      },
      { status: 403 },
    );
  }

  const limit = rateLimitFor("storage-purchase", clientIp(request), { max: 3, windowMs: 60 * 1000 });
  if (!limit.ok) {
    return Response.json(
      { error: "too_many_requests", retryAfter: limit.retryAfter },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const ref = `${user}/storage/${id}`;
  const before = await storageFor(user);
  const alreadyBought = await ledgerHasRef(user, "storage", ref);

  if (!alreadyBought) {
    const paid = await spend(user, EXTRA_STORAGE_CREDITS, "storage", ref);
    if (!paid) {
      return Response.json(
        {
          error: "no_credits",
          message:
            `${EXTRA_STORAGE_CREDITS} credits (about ${formatChf(creditsInRappen(EXTRA_STORAGE_CREDITS))}) ` +
            "buys 5 GB. Nothing was charged — either the balance does not cover it, or this " +
            "server has no database to record it in.",
          credits: EXTRA_STORAGE_CREDITS,
        },
        { status: 402 },
      );
    }
  }

  const after = await storageFor(user);
  return Response.json({
    ok: true,
    id,
    credits: EXTRA_STORAGE_CREDITS,
    addedBytes: EXTRA_STORAGE_BYTES,
    usedBytes: after.usedBytes,
    limitBytes: after.limitBytes,
    purchasedBytes: after.purchasedBytes,
    message: alreadyBought
      ? `This purchase (${id}) was already recorded — nothing was charged again.`
      : `Bought 5 GB for ${EXTRA_STORAGE_CREDITS} credits. This journal may now hold ` +
        `${after.limitBytes === null ? "as much as it likes" : formatBytes(after.limitBytes)}, up from ` +
        `${before.limitBytes === null ? "the same" : formatBytes(before.limitBytes)}. It does not expire.`,
  });
}
