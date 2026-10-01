import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { storageFor } from "@/lib/storageQuota";

export const dynamic = "force-dynamic";

/**
 * The storage bar a helper surface draws for its owner. Cookie-only and
 * owner-only like every helper route.
 *
 * Used to also carry a credit balance and a month's spend (B1208) — removed
 * with the credit system in B2592; billing is a plan now
 * (`@paid/credits/lib/entitlements.ts`), not a per-journal balance.
 */
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/helper/[user]/account">,
) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request, user);
  }

  const storage = await storageFor(user);
  return Response.json({
    ok: true,
    storage: { usedBytes: storage.usedBytes, ceilingBytes: storage.limitBytes },
  });
}
