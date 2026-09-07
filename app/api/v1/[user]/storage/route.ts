import { creditsEnabled, spend } from "@/lib/credits";
import { EXTRA_STORAGE_BYTES, EXTRA_STORAGE_CREDITS, formatChf, creditsInRappen } from "@/lib/credits/pricing";
import { isOwner } from "@/lib/contacts/session";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { authenticate, errorResponse, outOfScope, ownsUser } from "@/lib/api/auth";
import { cleanupPlan } from "@/lib/storageCleanup";
import { formatBytes, storageBreakdown, storageFor } from "@/lib/storageQuota";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

/**
 * Buy this journal five more gigabytes — B661.
 *
 * The one thing an owner can do about a full journal other than delete
 * photographs, and the only spend in this codebase that buys the journal
 * something rather than reaching somebody. It is a *spend*, not a grant:
 * nothing here can increase a balance, which is the property `lib/credits.ts`
 * is arranged around and `test/credits.test.ts` asserts.
 *
 * **The extension is the ledger row.** There is no storage table and no
 * expiry: `purchasedBytes` counts `storage` rows back, so a purchase is
 * lifetime because nothing exists that could end it. Buying twice adds twice.
 *
 * Owner-only, on the same `isOwner` cookie gate every other owner-only route
 * uses. A trip-scoped agent may fill a journal up; deciding to pay for more of
 * somebody else's disk is not its call.
 */
/**
 * Where the journal's space is going — B664.
 *
 * The same numbers `/[user]/me` renders, so "why is this journal full" has an
 * answer an agent can give without walking anything itself. A token may read
 * it: knowing the ceiling is close is what stops an agent starting a batch it
 * cannot finish, and none of it is anybody else's business — it is one
 * journal's own directory sizes.
 *
 * Not cached. It is the owner's own page and it must not lie about what is on
 * disk; the walk is a directory read per trip.
 */
export async function GET(request: Request, { params }: RouteContext<"/api/v1/[user]/storage">) {
  const auth = await authenticate(request);
  if (!auth.ok) return errorResponse(auth);

  const { user } = await params;
  if (!ownsUser(auth.session, user)) return outOfScope(auth.session, user);

  const usage = await storageFor(user);
  return Response.json({
    ...usage,
    breakdown: storageBreakdown(user).filter((row) => row.bytes > 0),
    reclaimable: await cleanupPlan(user),
    cleanup:
      "POST /api/v1/" +
      user +
      "/storage/cleanup — the owner's own session only. It removes generated " +
      "photobook PDFs and postcard sheets; every photograph, day and order record survives.",
  });
}

export async function POST(request: Request, { params }: RouteContext<"/api/v1/[user]/storage">) {
  const { user } = await params;

  const journal = getUser(user);
  if (!journal || !creditsEnabled()) {
    return Response.json(
      {
        error: "credits_disabled",
        message: "This server does not charge for storage, so there is nothing to buy.",
      },
      { status: 404 },
    );
  }

  /**
   * A bearer token is refused before anything else, the way
   * `app/[user]/postcards/[id]/send/route.ts` refuses one.
   *
   * `isOwner` alone would not do it: a journal-scoped agent token passes that
   * gate, by design, because an agent holding one *is* acting for the owner
   * on everything else. Spending the owner's credits on disk is not one of
   * those things — an agent that has just been refused an upload must report
   * it rather than buy its way out of it, and this is what makes that a
   * property of the server rather than of the guide's good manners.
   */
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
        message:
          "Only the address that owns this journal may buy storage for it — not a guest, " +
          "and not a token scoped to one of its trips.",
      },
      { status: 403 },
    );
  }

  // Authenticated and owner-only, so this is a stuck client rather than
  // anybody enumerating anything. Tight all the same: every retry that got
  // through would spend fifty credits.
  const limit = rateLimitFor("storage-purchase", clientIp(request), {
    max: 3,
    windowMs: 60 * 1000,
  });
  if (!limit.ok) {
    return Response.json(
      { error: "too_many_requests", retryAfter: limit.retryAfter },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const before = await storageFor(user);
  const paid = await spend(user, EXTRA_STORAGE_CREDITS, "storage", `${user}/storage`);
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

  const after = await storageFor(user);
  return Response.json({
    ok: true,
    credits: EXTRA_STORAGE_CREDITS,
    addedBytes: EXTRA_STORAGE_BYTES,
    usedBytes: after.usedBytes,
    limitBytes: after.limitBytes,
    purchasedBytes: after.purchasedBytes,
    message:
      `Bought 5 GB for ${EXTRA_STORAGE_CREDITS} credits. This journal may now hold ` +
      `${after.limitBytes === null ? "as much as it likes" : formatBytes(after.limitBytes)}, up from ` +
      `${before.limitBytes === null ? "the same" : formatBytes(before.limitBytes)}. It does not expire.`,
  });
}
