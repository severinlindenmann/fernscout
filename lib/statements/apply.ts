import "server-only";
import { getAllEntries, AS_AUTHOR } from "@/lib/entries";
import { editEntry, type CostInput } from "@/lib/api/entries";
import { COST_CATEGORIES, type CostCategory } from "@/lib/costFormat";
import { readTripJson, writeTripJson } from "@/lib/api/tripFile";
import type { TripFile } from "@/lib/api/v2/documents";
import type { Entry } from "@/lib/types";
import { COST_LABEL_MAX_CHARS, COST_LINES_MAX } from "@/lib/api/v2/schemas/day";

/**
 * Putting agreed costs on the days they happened — B677, and the *second* call.
 *
 * Reading a statement (`./read.ts`) reports; this writes, and it only ever
 * writes rows a caller sends back. That separation is the whole design: a
 * statement covering a fortnight holds the trip and everything either side of
 * it, and the category on each row is a person's editorial decision. Neither
 * of those is a server's to guess.
 *
 * What it does *not* do is decide which day a payment belongs to beyond the
 * date the bank recorded. A date with no day written is not dropped — B1844,
 * the owner's own ruling ("a cost you paid is a fact whether or not a day
 * exists for it"): it lands on the trip's own `costs.items` instead, the
 * block `trip.json` already carries for spend that belongs to no day. Rows
 * are still reported back by date (`filedToTrip`) so a caller can tell "went
 * to the trip" from "went to a day" — this used to be the API's own decision
 * to make *nothing* happen and let the caller `PATCH` the trip separately;
 * `app/api/helper/[user]/statement/apply/route.ts`'s browser flow already did
 * this and this is that same write, moved down to where both doors share it.
 */

/** One agreed row, as a caller sends it back. */
export type CostRow = {
  /** ISO calendar date — which day it goes on. */
  date: string;
  /** What it is called on the day. The merchant's own name, usually. */
  label: string;
  /** What it cost. Positive. */
  amount: number;
  currency: string;
  category: CostCategory;
};

export type ApplyResult = {
  written: { date: string; slug: string; added: number; kept: number }[];
  /** Rows whose date has no day in this trip — written to the trip's own
   * `costs.items` instead (B1844), and counted in `total` the same as a row
   * written to a day. */
  filedToTrip: { date: string; rows: number }[];
  total: number;
};

export type ApplyProblem = { row: number; field: string; got: string; expected: string };

/**
 * Check the rows before any of them is written.
 *
 * All at once, like every other write door here: a caller sending forty rows
 * should learn about all four mistakes in one answer rather than in four round
 * trips.
 */
export function validateRows(rows: unknown): { rows: CostRow[] } | { problems: ApplyProblem[] } {
  if (!Array.isArray(rows) || rows.length === 0)
    return {
      problems: [
        { row: -1, field: "rows", got: Array.isArray(rows) ? "an empty list" : typeof rows, expected: "a list of agreed costs" },
      ],
    };

  const problems: ApplyProblem[] = [];
  const clean: CostRow[] = [];
  rows.forEach((raw, index) => {
    const r = (raw ?? {}) as Partial<CostRow>;
    const complain = (field: string, got: unknown, expected: string) =>
      problems.push({ row: index, field, got: String(got), expected });

    if (typeof r.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(r.date))
      complain("date", r.date, "an ISO date, YYYY-MM-DD");
    if (typeof r.label !== "string" || r.label.trim() === "")
      complain("label", r.label, "what to call this cost on the day");
    if (typeof r.amount !== "number" || !Number.isFinite(r.amount) || r.amount <= 0)
      // Deliberately not "any number": a statement's sign is the statement's,
      // and a negative cost on a day renders as a negative total nobody meant.
      complain("amount", r.amount, "a positive amount — what it cost");
    if (typeof r.currency !== "string" || !/^[A-Za-z]{3}$/.test(r.currency))
      complain("currency", r.currency, "an ISO-4217 code");
    if (typeof r.category !== "string" || !(COST_CATEGORIES as readonly string[]).includes(r.category))
      complain("category", r.category, `one of ${COST_CATEGORIES.join(", ")}`);

    if (problems.every((p) => p.row !== index))
      clean.push({
        date: r.date as string,
        label: (r.label as string).trim(),
        amount: r.amount as number,
        currency: (r.currency as string).toUpperCase(),
        category: r.category as CostCategory,
      });
  });

  return problems.length > 0 ? { problems } : { rows: clean };
}

/**
 * The day a cost goes on, when a date has several.
 *
 * The earliest by `time:`, not the first filename alphabetically — a day
 * written as "morning" and "evening" would otherwise take its costs on
 * whichever slug sorted first, which is a coin toss dressed up as a rule.
 */
function dayFor(entries: Entry[], date: string): Entry | undefined {
  return entries
    .filter((e) => e.date === date)
    .sort((a, b) => (a.time ?? "").localeCompare(b.time ?? ""))[0];
}

/**
 * B2243 review F1 — the same bounds a day's own write is held to. A label is
 * a bank descriptor, and one longer than `COST_LABEL_MAX_CHARS` is cut to it
 * rather than refused (a statement is not the caller's to reword). A day, or
 * the trip's own `costs.items`, that these rows would push past
 * `COST_LINES_MAX` refuses the whole call before anything is written — the
 * problems say which date and how many lines are already there.
 */
function boundedLabel(label: string): string {
  return label.length > COST_LABEL_MAX_CHARS ? label.slice(0, COST_LABEL_MAX_CHARS).trimEnd() : label;
}

export function applyCosts(ref: string, rows: CostRow[]): ApplyResult | { problems: ApplyProblem[] } {
  // Drafts included, and no visibility narrowing: the caller already passed
  // `mayWriteTrip` (this route's own gate), the same standing as the person
  // who wrote the day, so a day or gallery item declared `guest`/`private`
  // must not read as absent here the way it would to a public reader —
  // that read exactly as "no day for that date" and orphaned every row of a
  // real day (B1647). `AS_AUTHOR` is the named constant for "already
  // checked who this is" (lib/entries.ts).
  const entries = getAllEntries(ref, AS_AUTHOR);

  const byDate = new Map<string, CostRow[]>();
  for (const row of rows) {
    const list = byDate.get(row.date);
    if (list) list.push(row);
    else byDate.set(row.date, [row]);
  }

  const overflow: ApplyProblem[] = [];
  let tripBound = 0;
  for (const [date, list] of byDate) {
    const entry = dayFor(entries, date);
    if (!entry) {
      tripBound += list.length;
      continue;
    }
    const have = entry.costs?.length ?? 0;
    if (have + list.length > COST_LINES_MAX) {
      overflow.push({
        row: -1,
        field: "rows",
        got: `${list.length} more on ${date}, which already has ${have}`,
        expected: `at most ${COST_LINES_MAX} cost lines on one day`,
      });
    }
  }
  if (tripBound > 0) {
    const have = readTripJson(ref)?.trip.costs?.items?.length ?? 0;
    if (have + tripBound > COST_LINES_MAX) {
      overflow.push({
        row: -1,
        field: "rows",
        got: `${tripBound} more on the trip's own costs (dates with no day), which already has ${have}`,
        expected: `at most ${COST_LINES_MAX} cost lines there`,
      });
    }
  }
  if (overflow.length > 0) return { problems: overflow };

  const written: ApplyResult["written"] = [];
  const filedToTrip: ApplyResult["filedToTrip"] = [];
  const forTrip: CostRow[] = [];
  let total = 0;

  for (const [date, list] of [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const entry = dayFor(entries, date);
    if (!entry) {
      filedToTrip.push({ date, rows: list.length });
      forTrip.push(...list);
      continue;
    }

    // Kept, not replaced: somebody may have written costs of their own on this
    // day, and a statement import is not entitled to remove them. `editEntry`
    // takes the whole list, so the merge happens here.
    const kept: CostInput[] = (entry.costs ?? []).map((c) => ({
      label: c.label,
      amount: c.amount,
      currency: c.currency,
      category: c.category,
    }));
    const adding: CostInput[] = list.map((r) => ({
      label: boundedLabel(r.label),
      amount: r.amount,
      currency: r.currency,
      category: r.category,
    }));

    const result = editEntry(ref, entry.slug, { costs: [...kept, ...adding] });
    if (!result.ok) {
      // A day that refuses its own costs is a bug rather than a caller
      // error — filed to the trip the same as a day-less date, rather than
      // dropped, for the same B1844 reason: a cost that was paid is a fact
      // either way.
      filedToTrip.push({ date, rows: list.length });
      forTrip.push(...list);
      continue;
    }
    written.push({ date, slug: entry.slug, added: adding.length, kept: kept.length });
    total += adding.length;
  }

  if (forTrip.length > 0) {
    total += fileToTripCosts(ref, forTrip);
  }

  return { written, filedToTrip, total };
}

/**
 * B1844, B689's D10 — appending rows with no day onto the trip's own
 * `costs.items`. Carried over from `app/api/helper/[user]/statement/apply/
 * route.ts`'s own `fileToTripCosts`, which was the browser flow's private
 * copy of exactly this write; moved here so the v2 API's `costs/apply`
 * shares it instead of reporting these rows as unwritten.
 *
 * Deliberately not `patchCosts` (`lib/api/costs.ts`): that writer is
 * merge-only and refuses a trip whose `costs` section does not exist yet
 * (an ordinary trip, unless its costs visibility was set to "guests" at
 * creation — see its own doc comment), which most trips reaching here
 * actually are. This does the same read-modify-write `patchCosts` does,
 * through the same primitives (`readTripJson`/`writeTripJson`), the one
 * difference being that a missing section is created rather than refused.
 */
function fileToTripCosts(ref: string, rows: CostRow[]): number {
  const read = readTripJson(ref);
  if (!read) return 0;
  const existing = read.trip.costs;
  const items = [
    ...(existing?.items ?? []),
    ...rows.map((r) => ({ label: boundedLabel(r.label), amount: r.amount, currency: r.currency, category: r.category })),
  ];
  const costs = { ...existing, items } as NonNullable<TripFile["costs"]>;
  writeTripJson(read.file, { ...read.trip, costs });
  return rows.length;
}
