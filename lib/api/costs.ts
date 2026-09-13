import "server-only";
import { parseBudget } from "../costFormat";
import { getTrip } from "../trips";
import type { TripFile } from "./v2/documents";
import { readTripJson, writeTripJson } from "./tripFile";

/**
 * Amending a trip's costs section through the API — B295.
 *
 * `lib/costs.ts` reads this and, before B1598, this module wrote a separate
 * `costs.md`; since B1606/B1598 a trip's preparation budget, its items and
 * its note are the `costs` section of the one `trip.json` (`readCostsFile`
 * in lib/costs.ts already reads `trip.costsSection`, which is exactly this
 * field). `patchCosts` merges onto what is there, mirroring `editEntry`'s
 * read-modify-write for a day — the same writer both `PATCH
 * /api/v1/{user}/trips/{trip}/costs` used and `app/api/helper/[user]/trip
 * /budget/route.ts` still calls. Creating or wholly replacing the section is
 * `PATCH /api/v2/{user}/trips/{trip}` now (B1632 retired the v1 `PUT`/
 * `DELETE` on this door once the trip document's own `costs` field covered
 * create, replace and decline).
 *
 * `budget` and `costs` are validated by `lib/validate/costs.ts` before
 * anything here runs — this module only reshapes what already passed into
 * `trip.json`'s own field names.
 *
 * **`visibility` is untouched by this call.** It is `PATCH
 * .../trips/{trip}` (`lib/api/tripDetails.ts`'s `costsVisibility`) that owns
 * who may see the numbers; this module only ever carries forward whatever is
 * already stored for it.
 */

/**
 * `days` is optional, matching the trip document's own `costs.budget` — a
 * budget can name a total without committing to how many days it is spread
 * over, and `lib/costs.ts` already treats a missing one as "no per-day
 * figure" rather than as zero. It was required here while this type was
 * hand-written beside the schema instead of derived from it, which is the
 * kind of quiet disagreement the v2 contract exists to stop.
 */
type CostsBudgetInput = { total: number; days?: number; currency?: string };
type CostsItemInput = { label: string; amount: number; category?: string; currency?: string };
type CostsSection = NonNullable<TripFile["costs"]>;

/** The body of `PATCH .../costs` — every field optional, and `budget: null`
 * an explicit clear rather than "leave it alone". */
export type CostsEditInput = {
  budget?: CostsBudgetInput | null;
  costs?: CostsItemInput[];
  body?: string;
};

export type CostsWriteResult =
  | { ok: true }
  | { ok: false; error: string; bug?: true };

/** The `costs` section to write, carrying forward whatever `visibility` was
 * already stored (a different door's field, see the module docblock). */
function costsSectionOf(
  existingVisibility: CostsSection["visibility"] | undefined,
  budget: CostsBudgetInput | null | undefined,
  costs: CostsItemInput[] | undefined,
  body: string | undefined,
): CostsSection | undefined {
  const section: Partial<CostsSection> = {
    ...(budget ? { budget: budget as CostsSection["budget"] } : {}),
    ...(costs?.length ? { items: costs as CostsSection["items"] } : {}),
    ...(body?.trim() ? { note: body.trim() } : {}),
    ...(existingVisibility ? { visibility: existingVisibility } : {}),
  };
  return Object.keys(section).length ? (section as CostsSection) : undefined;
}

/**
 * The write just made, read back — or a sentence saying what is wrong with
 * it. Same instinct as `draftDoesNotReadBack` (lib/api/entries.ts, B208): a
 * budget can fail to parse as a *budget* even from valid JSON — a zero total
 * is exactly B263's failure, one layer up from the validator that is
 * supposed to have already refused it.
 */
function costsDoesNotReadBack(ref: string, budgetWritten: CostsBudgetInput | null | undefined): string | null {
  const section = getTrip(ref)?.costsSection;
  if (budgetWritten && !parseBudget(section?.budget)) {
    return "its budget does not read back — check that the total and days are both positive numbers";
  }
  return null;
}

/** Amend a trip's costs section without resending the whole thing — `PATCH
 * .../costs`. */
export function patchCosts(ref: string, input: CostsEditInput): CostsWriteResult {
  const trip = getTrip(ref);
  if (!trip) return { ok: false, error: "unknown_trip" };

  const existing = trip.costsSection;
  if (!existing) {
    return {
      ok: false,
      error:
        `${ref} has no costs section yet, so there is nothing to amend. PATCH ` +
        "/api/v2/{user}/trips/{trip} with a costs object to create one.",
    };
  }

  const read = readTripJson(ref);
  if (!read) return { ok: false, error: "unknown_trip" };

  const budget = input.budget === undefined ? existing.budget : (input.budget ?? undefined);
  const costs = input.costs === undefined ? existing.items : input.costs;
  const body = input.body === undefined ? existing.note : input.body;

  const nextCosts = costsSectionOf(existing.visibility, budget, costs, body);
  writeTripJson(read.file, { ...read.trip, costs: nextCosts });

  const unreadable = costsDoesNotReadBack(ref, budget);
  if (unreadable) {
    return {
      ok: false,
      bug: true,
      error: `The edit was written but ${unreadable}. This is a bug; please report it.`,
    };
  }
  return { ok: true };
}
