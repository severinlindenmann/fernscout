import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { balanceOf } from "@/lib/credits";
import { getDatabaseOrNull } from "@/lib/db";
import { storageFor } from "@/lib/storageQuota";

export const dynamic = "force-dynamic";

/**
 * What the room's credit chip opens — B1208 (decision D06/D07).
 *
 * The same three facts the `account` tool answers in prose, as numbers a
 * sheet can draw: the balance, what this month has cost in credits (the
 * ledger's own negative rows — units the person was actually charged, never
 * the operator's token accounting), and the storage bar. Cookie-only and
 * owner-only like every helper route; `credits: null` means this instance
 * charges for nothing and the chip is not drawn at all.
 */
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/helper/[user]/account">,
) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request, user);
  }
  const credits = await balanceOf(user);

  // The month's spends, from the ledger — the honest per-journal number.
  // Fails soft to null: the sheet then shows the balance alone rather than
  // the chip failing over an accounting read.
  let monthSpent: number | null = null;
  try {
    const handle = await getDatabaseOrNull();
    if (handle) {
      const monthStart = `${new Date().toISOString().slice(0, 7)}-01`;
      const rows = await handle.db
        .selectFrom("credit_ledger")
        .select(["delta"])
        .where("owner_id", "=", user)
        .where("created_at", ">=", monthStart)
        .execute();
      monthSpent = rows
        .map((row) => Number(row.delta))
        .filter((n) => n < 0)
        .reduce((sum, n) => sum - n, 0) / 100;
    }
  } catch {
    monthSpent = null;
  }

  const storage = await storageFor(user);
  return Response.json({
    ok: true,
    credits,
    monthSpent,
    storage: { usedBytes: storage.usedBytes, ceilingBytes: storage.limitBytes },
  });
}
