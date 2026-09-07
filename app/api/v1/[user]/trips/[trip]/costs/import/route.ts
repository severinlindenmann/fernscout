import { authenticate, errorResponse, mayWriteTrip, outOfScope, ownsUser } from "@/lib/api/auth";
import { applyCosts, validateRows } from "@/lib/statements/apply";
import { getTrip, tripRef } from "@/lib/trips";
import { COST_CATEGORIES } from "@/lib/costFormat";

export const dynamic = "force-dynamic";

/**
 * The agreed rows, onto the days they happened — B677, and the second half of
 * a `costs` import.
 *
 * `POST /api/v1/<user>/import` reads a statement and writes nothing. This is
 * where somebody says *these* payments were the trip, and *this* is what each
 * one was for. Two calls because there are two decisions in between, and
 * neither of them is a server's:
 *
 * - **Which rows.** A statement covering a fortnight holds the trip, the rent
 *   and the phone bill.
 * - **Which category.** A statement says what was paid, never what it was for.
 *   `other` is a real answer and a fine one; a guess dressed as a category is
 *   not.
 *
 * Unlike the import itself, this one is **writable by anybody who may write
 * the trip**, trip-scoped tokens included: it takes rows a person has already
 * agreed and puts them on days of that trip. Nothing here reads the owner's
 * statement, and nothing here reaches outside the trip in the URL.
 *
 * It **adds**, never replaces: costs somebody wrote by hand stay, and running
 * it twice with the same rows writes them twice — which is visible on the day
 * and correctable there, and is the honest behaviour for an append.
 */
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/v1/[user]/trips/[trip]/costs/import">,
) {
  const auth = await authenticate(request);
  if (!auth.ok) return errorResponse(auth);

  const { user, trip: tripId } = await params;
  if (!ownsUser(auth.session, user)) return outOfScope(auth.session, user);

  const trip = getTrip(tripRef(user, tripId));
  if (!trip) return Response.json({ error: "unknown_trip" }, { status: 404 });

  const gate = await mayWriteTrip(auth.session, trip);
  if (!gate.ok) return Response.json({ error: gate.error }, { status: gate.status });

  const body = (await request.json().catch(() => null)) as { rows?: unknown } | null;
  const checked = validateRows(body?.rows);
  if ("problems" in checked) {
    return Response.json(
      {
        error: "invalid_costs",
        problems: checked.problems,
        hint:
          `Each row is {date, label, amount, currency, category}. The amount is positive — ` +
          `what it cost — and the category is one of ${COST_CATEGORIES.join(", ")}. ` +
          "The import call's `merchants` list is the one to agree categories against: one " +
          "decision per merchant covers every payment to it.",
      },
      { status: 400 },
    );
  }

  const result = applyCosts(trip.ref, checked.rows);

  return Response.json({
    trip: trip.id,
    ...result,
    message:
      `${result.total} cost${result.total === 1 ? "" : "s"} written across ` +
      `${result.written.length} day${result.written.length === 1 ? "" : "s"}.` +
      (result.written.some((w) => w.kept > 0)
        ? " Costs already on those days were kept."
        : ""),
    ...(result.orphaned.length > 0
      ? {
          next:
            `${result.orphaned.length} date${result.orphaned.length === 1 ? " has" : "s have"} ` +
            "no day written yet, so nothing was recorded for them. Write those days first " +
            "and send their rows again — or leave them out, if nothing happened worth " +
            "writing up.",
        }
      : {}),
  });
}
