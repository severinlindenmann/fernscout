// Validates a trip's costs.md contents — the budget and the preparation
// costs — before they become a file. B295.
//
// Pure, like lib/validate/entry.ts beside it: no fs, so this is testable
// with a plain object literal and shared between the REST route and its
// tests without dragging the filesystem in.
//
// The preparation-costs list reuses `checkCosts` from lib/validate/entry.ts
// rather than forming a second opinion — a day's costs and a trip's
// preparation costs are the same shape (label, amount, category, currency),
// and B295 is explicit that this door refuses exactly what the existing
// validation refuses. Since B304, `checkCosts` itself checks currency shape
// and a non-positive amount — it originally didn't, which is why this file
// used to carry its own copy of both checks; that copy is gone now that the
// shared function does the same work, for the day-costs door as well as this
// one.
import { checkCosts, checkCurrencyCode, describe, type EntryInput, type Problem } from "./entry";

export type BudgetInput = { total?: unknown; days?: unknown; currency?: unknown };

/**
 * `required` is true for `PUT` — the whole point of B295 is a budget an
 * agent can write — and false for `PATCH`, where an absent `budget` means
 * "leave it alone". `null` is the third state only `PATCH` needs: an
 * explicit clear, the same convention every other splice in this codebase
 * uses (`spliceScalar`'s `rendered: null`, lib/api/entries.ts).
 */
function checkBudget(raw: unknown, problems: Problem[], required: boolean): void {
  if (raw === undefined || raw === null) {
    if (required) {
      problems.push({
        field: "budget",
        got: "nothing",
        expected: "an object: {total, days, currency?} — total and days both required and positive",
      });
    }
    return;
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    problems.push({ field: "budget", got: describe(raw), expected: "an object: {total, days, currency?}" });
    return;
  }
  const b = raw as BudgetInput;
  if (typeof b.total !== "number" || !Number.isFinite(b.total) || b.total <= 0) {
    problems.push({
      field: "budget.total",
      got: describe(b.total),
      expected:
        "a positive number. A zero or missing total is refused here, rather than written and " +
        "read back as no budget at all — which is what lib/costFormat.ts's parseBudget does " +
        "silently for a page render (B263).",
    });
  }
  if (typeof b.days !== "number" || !Number.isFinite(b.days) || b.days <= 0) {
    problems.push({ field: "budget.days", got: describe(b.days), expected: "a positive number of days" });
  }
  checkCurrencyCode("budget.currency", b.currency, problems);
}

function checkCostsList(raw: unknown, problems: Problem[]): void {
  if (raw === undefined) return;
  checkCosts({ costs: raw } as EntryInput, problems);
}

function checkBody(raw: unknown, problems: Problem[]): void {
  if (raw === undefined) return;
  if (typeof raw !== "string") {
    problems.push({ field: "body", got: describe(raw), expected: "a string — the trip's own prose about the money" });
  }
}

export type CostsInput = { budget?: unknown; costs?: unknown; body?: unknown };

/** `PUT .../costs` — the whole file, so a budget is required. */
export function validateCostsPut(input: CostsInput): Problem[] {
  const problems: Problem[] = [];
  checkBudget(input.budget, problems, true);
  checkCostsList(input.costs, problems);
  checkBody(input.body, problems);
  return problems;
}

/**
 * `PATCH .../costs` — a partial edit, so every field is optional and an
 * absent one means "leave it alone", the same rule `validateEntryEdit`
 * applies to a day.
 */
export function validateCostsPatch(input: CostsInput): Problem[] {
  const problems: Problem[] = [];
  checkBudget(input.budget, problems, false);
  checkCostsList(input.costs, problems);
  checkBody(input.body, problems);
  return problems;
}
