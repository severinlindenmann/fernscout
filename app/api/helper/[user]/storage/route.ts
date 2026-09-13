import { creditsEnabled, ledgerHasRef, spend } from "@/lib/credits";
import { EXTRA_STORAGE_BYTES, EXTRA_STORAGE_CREDITS } from "@/lib/credits/pricing";
import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { refused, wrote } from "@/lib/helper/thread";
import { storageFor } from "@/lib/storageQuota";

export const dynamic = "force-dynamic";

/**
 * Five more gigabytes, from the room — B1042 batch (`buy_room` in
 * `lib/helper/tools/areas/journal.ts`).
 *
 * The same spend `PUT /api/web/<user>/storage/purchases/<id>` makes, behind
 * the same conditional `UPDATE` — see `lib/credits.ts` property 2. Nothing
 * here can raise a balance; a failed spend is `no_credits` and nothing is
 * added.
 *
 * **Idempotent the same way that door is (B1659).** `buy_room`'s own
 * `propose` mints `id` once and carries it as a fixed field through the
 * press, so a retried request — a double-tap, a network retry — arrives
 * with the *same* id and is recognised by `ledgerHasRef` before `spend` runs
 * again, rather than charging twice. Missing or blank `id` is refused
 * outright rather than falling back to a constant ref: that was the bug.
 *
 * Cookie only, owner only, outside `/api/v1` and outside the published
 * contract, for the reason `app/api/helper/[user]/day/route.ts` sets out at
 * length.
 */
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/helper/[user]/storage">,
) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request, user);
  }
  if (!creditsEnabled()) {
    refused(user, "buy_room", "credits_disabled");
    return Response.json({ error: "credits_disabled" }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const id = typeof body?.id === "string" ? body.id.trim() : "";
  if (!id) {
    refused(user, "buy_room", "invalid_request");
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  const ref = `${user}/storage/${id}`;
  const alreadyBought = await ledgerHasRef(user, "storage", ref);
  if (!alreadyBought) {
    const paid = await spend(user, EXTRA_STORAGE_CREDITS, "storage", ref);
    if (!paid) {
      refused(user, "buy_room", "no_credits");
      return Response.json({ error: "no_credits" }, { status: 402 });
    }
  }

  const after = await storageFor(user);
  wrote(user, "buy_room", { credits: EXTRA_STORAGE_CREDITS, addedBytes: EXTRA_STORAGE_BYTES });
  return Response.json({
    ok: true,
    credits: EXTRA_STORAGE_CREDITS,
    limitBytes: after.limitBytes,
    already: alreadyBought || undefined,
    message: alreadyBought
      ? "This purchase was already recorded — nothing was charged again."
      : undefined,
  });
}
