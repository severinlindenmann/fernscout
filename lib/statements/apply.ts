import "server-only";
import { getAllEntries } from "@/lib/entries";
import { editEntry, type CostInput } from "@/lib/api/entries";
import { COST_CATEGORIES, type CostCategory } from "@/lib/costFormat";
import type { Entry } from "@/lib/types";

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
 * date the bank recorded. A date with no day written is reported back, not
 * quietly attached to the nearest one.
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
  /** Rows whose date has no day in this trip. Nothing was written for them. */
  orphaned: { date: string; rows: number }[];
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

export function applyCosts(ref: string, rows: CostRow[]): ApplyResult {
  // Drafts included: the days a statement is being read into are usually the
  // ones nobody has published yet, and refusing to cost a draft would mean
  // publishing first — which is the wrong order and somebody else's decision.
  const entries = getAllEntries(ref, { includeDrafts: true });

  const byDate = new Map<string, CostRow[]>();
  for (const row of rows) {
    const list = byDate.get(row.date);
    if (list) list.push(row);
    else byDate.set(row.date, [row]);
  }

  const written: ApplyResult["written"] = [];
  const orphaned: ApplyResult["orphaned"] = [];
  let total = 0;

  for (const [date, list] of [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const entry = dayFor(entries, date);
    if (!entry) {
      orphaned.push({ date, rows: list.length });
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
      label: r.label,
      amount: r.amount,
      currency: r.currency,
      category: r.category,
    }));

    const result = editEntry(ref, entry.slug, { costs: [...kept, ...adding] });
    if (!result.ok) {
      // A day that refuses its own costs is a bug rather than a caller error,
      // and losing the rest of the statement over it helps nobody.
      orphaned.push({ date, rows: list.length });
      continue;
    }
    written.push({ date, slug: entry.slug, added: adding.length, kept: kept.length });
    total += adding.length;
  }

  return { written, orphaned, total };
}
