import { editEntry, type CostInput } from "@/lib/api/entries";
import { AS_AUTHOR, getAllEntries, getEntryBySlug } from "@/lib/entries";
import { refused } from "@/lib/helper/thread";
import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { getTrip, tripRef } from "@/lib/trips";
import { validateEntryEdit } from "@/lib/validate/entry";
import { wrote } from "@/lib/helper/thread";

export const dynamic = "force-dynamic";

/**
 * One receipt, from a browser — B820.
 *
 * The costs page has been good for a long time and there has never been a way
 * to put anything into it: entering a cost was `PATCH /api/v1/…/days/<slug>`
 * with a `costs[]` array, which is an agent or a script. A person home from a
 * trip with a shoebox of receipts had an excellent page to read and no form to
 * fill.
 *
 * Nothing here is new machinery. `editEntry` has written `costs:` since W38
 * and validates every field of it (`checkCosts`, lib/validate/entry.ts), so
 * this route is the two things the browser cannot do for itself: **append**
 * rather than replace — `costs:` is rewritten wholesale by an edit, and a form
 * that sent only the new line would silently delete every earlier one — and
 * find the day a date belongs to, because a receipt turns up after the fact
 * and the day it is for is usually not the day on the screen.
 *
 * Cookie only, owner only, outside `/api/v1` and outside the published
 * contract, for the reason `../route.ts` gives at length: a wizard driving the
 * v1 routes would need a seven-day write token in a page.
 *
 * There is no `PUT .../trips/<trip>/costs` here. A trip's budget is a rarer
 * thing and a different screen; B820 is the receipt.
 */

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

export async function POST(request: Request, { params }: RouteContext<"/api/helper/[user]/day/costs">) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) return notYourJournal(request, user);

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "invalid_json" }, { status: 400 });

  const tripId = text(body.trip) ?? "";
  const ref = tripRef(user, tripId);
  if (!getTrip(ref)) return Response.json({ error: "unknown_trip" }, { status: 404 });

  const here = getEntryBySlug(ref, text(body.slug) ?? "", AS_AUTHOR);
  if (!here) return Response.json({ error: "unknown_day" }, { status: 404 });

  // The day this receipt is for. Absent means the one on the screen, which is
  // the common case and the default the form shows.
  const date = text(body.date) ?? here.date;
  const target =
    date === here.date
      ? here
      : getAllEntries(ref, AS_AUTHOR).find((entry) => entry.date === date);
  // Deliberately not "so we made one": a day nobody has written is a day
  // nobody has described, and inventing it to hang a number on would be this
  // software writing a day it was not told about.
  if (!target) return Response.json({ error: "no_day_on_date", date }, { status: 404 });

  const added: CostInput = {
    label: text(body.label) ?? "",
    amount: typeof body.amount === "number" ? body.amount : Number(body.amount),
    // Absent is not "guess": `editEntry` stamps the day's own place-currency
    // or the journal's base, which is the same rule a written file follows.
    ...(text(body.currency) ? { currency: text(body.currency) } : {}),
    ...(text(body.category) ? { category: text(body.category) } : {}),
  };

  // The closed list, the currency code and a positive amount — `checkCosts`
  // in lib/validate/entry.ts, the identical check `PATCH /api/v1/…/days/<slug>`
  // makes. `editEntry` itself validates nothing (every route here is expected
  // to have done it), so a form that skipped this would write
  // `category: shopping` into somebody's file and the costs page would quietly
  // read it back as "other". Only the new line is checked: what is already on
  // the day was accepted when it was written.
  const problems = validateEntryEdit({ costs: [added] });
  if (problems.length > 0) {
    refused(user, "add_cost", "invalid_cost");
    return Response.json({ error: "invalid_cost", problems }, { status: 400 });
  }

  // Appended. Everything already on the day is sent back unchanged, so the
  // wholesale rewrite of the block is a no-op for it — and sending it also
  // retracts an `unrecorded: [costs]` the day was carrying, which is right:
  // somebody has now written down what nobody had.
  const costs: CostInput[] = [...target.costs, added];
  const edited = editEntry(ref, target.slug, { costs });
  if (!edited.ok) {
    return Response.json({ error: edited.error }, { status: edited.bug ? 500 : 400 });
  }

  const now = getEntryBySlug(ref, target.slug, AS_AUTHOR);
  wrote(user, "add_cost", { trip: tripId, slug: target.slug, date });
  return Response.json({ ok: true, trip: tripId, slug: target.slug, date, costs: now?.costs ?? costs });
}
