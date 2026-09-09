import { refused, wrote } from "@/lib/helper/thread";
import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { getTrip, tripRef } from "@/lib/trips";
import { COST_CATEGORIES, conversionFor, readCostsFile, type CostCategory } from "@/lib/costs";
import { parseCostItems } from "@/lib/costFormat";
import { patchCosts, type CostsEditInput } from "@/lib/api/costs";
import { validateCostsPatch } from "@/lib/validate/costs";
import { normalizeCurrency } from "@/lib/currency";

export const dynamic = "force-dynamic";

/**
 * A trip's planned budget, and one thing paid for before leaving —
 * `costs.md`'s own two fields, from the wizard's `set_budget` (B1042).
 *
 * Both are amended with `patchCosts`, the same writer `PATCH
 * /api/v1/<user>/trips/<trip>/costs` calls, and never the `PUT` that would
 * replace the whole file. `budget` is sent whole — it always is, the same
 * rule `PATCH .../costs` follows — but a preparation cost is **appended**
 * rather than sent alone: `patchCosts` replaces the whole `costs:` list
 * wholesale when the field is present, so sending only the new line would
 * silently delete every one already on the file. The route reads what is
 * there first, the same discipline `../day/costs/route.ts` uses for a day's
 * own costs.
 *
 * Cookie only, owner only, outside `/api/v1` and outside the published
 * contract — same reasoning as every other route in `app/api/helper/`.
 */

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function num(value: unknown): number | undefined {
  if (typeof value === "string" && value.trim() === "") return undefined;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export async function POST(
  request: Request,
  { params }: RouteContext<"/api/helper/[user]/trip/budget">,
) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) return notYourJournal(request, user);

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "invalid_json" }, { status: 400 });

  const tripId = text(body.trip) ?? "";
  const ref = tripRef(user, tripId);
  if (!getTrip(ref)) return Response.json({ error: "unknown_trip" }, { status: 404 });

  const { base } = conversionFor(ref);
  const patch: CostsEditInput = {};

  const total = num(body.total);
  const days = num(body.days);
  if (total !== undefined && days !== undefined) {
    const currency = text(body.currency);
    patch.budget = { total, days, ...(currency ? { currency } : {}) };
  }

  const prepLabel = text(body.prepLabel);
  const prepAmount = num(body.prepAmount);
  if (prepLabel !== undefined && prepAmount !== undefined) {
    const parsed = readCostsFile(ref);
    const existing = parsed ? parseCostItems(parsed.data.costs, base) : [];
    const said = text(body.prepCategory)?.toLowerCase();
    const category = ((COST_CATEGORIES as readonly string[]).find((one) => one === said) ??
      "preparation") as CostCategory;
    patch.costs = [
      ...existing.map((item) => ({
        label: item.label,
        amount: item.amount,
        currency: item.currency,
        category: item.category,
      })),
      {
        label: prepLabel,
        amount: prepAmount,
        category,
        currency: normalizeCurrency(body.prepCurrency) || base,
      },
    ];
  }

  if (patch.budget === undefined && patch.costs === undefined) {
    refused(user, "set_budget", "invalid_request");
    return Response.json(
      {
        error: "invalid_request",
        message:
          "Send a total and days for the budget, or a prepLabel and prepAmount for something paid for before leaving.",
      },
      { status: 400 },
    );
  }

  const problems = validateCostsPatch(patch);
  if (problems.length > 0) {
    refused(user, "set_budget", "invalid_costs");
    return Response.json({ error: "invalid_costs", problems }, { status: 400 });
  }

  const result = patchCosts(ref, patch);
  if (!result.ok) {
    refused(user, "set_budget", result.error);
    return Response.json({ error: result.error }, { status: result.bug ? 500 : 400 });
  }

  const changed = Object.keys(patch);
  wrote(user, "set_budget", { trip: tripId, changed });
  return Response.json({ ok: true, trip: tripId, changed });
}
