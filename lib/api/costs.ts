import "server-only";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { costsFilePath } from "../costs";
import { parseBudget } from "../costFormat";
import { getTrip } from "../trips";
import { quoteScalar } from "../validate/frontmatter";
import { costLines, type DraftInput } from "./entries";

/**
 * Writing costs.md through the API — B295.
 *
 * `lib/costs.ts` reads this file and never wrote it; the only ways a budget
 * existed were the `add-a-trip` skill on a local checkout and editing the
 * file over SSH, which is exactly the shape AGENTS.md treats as a defect:
 * "if an agent will not do a thing on the owner's behalf, the thing cannot
 * be done at all." This is the write half.
 *
 * `budget` and `costs` are validated by `lib/validate/costs.ts` before
 * anything here runs — this module only renders and splices what already
 * passed. `PUT` replaces the whole file; `PATCH` splices textually, the same
 * discipline `editEntry` (lib/api/entries.ts, B266) uses for a day, so a
 * hand-written `costs.md` keeps its formatting, comments and key order.
 */

export type CostsBudgetInput = { total: number; days: number; currency?: string };
export type CostsItemInput = { label: string; amount: number; category?: string; currency?: string };

/** The body of `PUT .../costs` — the whole file. `budget` is required there
 * (see `validateCostsPut`); this type does not enforce that, the validator
 * does. */
export type CostsFileInput = {
  budget?: CostsBudgetInput;
  costs?: CostsItemInput[];
  body?: string;
};

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

/**
 * The `budget:` block, one line, flow style — the same shape
 * `content/example/**\/costs.md` and the ticket's own on-disk reference use.
 * `undefined`/`null` writes nothing: no budget, no line.
 */
function budgetLines(budget: CostsBudgetInput | null | undefined): string[] {
  if (!budget) return [];
  const fields = [
    `total: ${budget.total}`,
    `days: ${budget.days}`,
    ...(budget.currency ? [`currency: ${quoteScalar(budget.currency.trim().toUpperCase())}`] : []),
  ];
  return [`budget: { ${fields.join(", ")} }`];
}

/**
 * The `costs:` list rendered by `lib/api/entries.ts`'s `costLines` — a
 * trip's preparation costs are the identical shape as a day's, so this
 * reuses the one writer rather than a second copy that could drift from it.
 */
function costsLines(costs: CostsItemInput[] | undefined): string[] {
  return costLines(costs as DraftInput["costs"]);
}

/**
 * The line naming `key` inside the frontmatter block, or -1. Mirrors
 * `frontmatterLineOf` in lib/api/entries.ts (B266) — kept local rather than
 * shared, since the two writers touch different files and importing across
 * would only couple them for a five-line function.
 */
function frontmatterLineOf(lines: string[], closing: number, key: string): number {
  const pattern = new RegExp(`^${key}:(\\s|$)`);
  return lines.findIndex((line, i) => i > 0 && i < closing && pattern.test(line));
}

/**
 * Replace, insert or remove one top-level frontmatter key and everything
 * indented under it. Works whether the key is written flow style on one
 * line (`budget: { ... }`, what this writer emits) or block style, spread
 * over several indented lines (what `add-a-trip`'s own example shows, and
 * what a person is just as likely to have typed) — the extent is found by
 * indentation, the same way `spliceCosts` (lib/api/entries.ts) finds the
 * end of a day's `costs:` list, so a `PATCH` does not care which style the
 * file already uses.
 *
 * `newLines` empty removes the key entirely. Returns the closing marker's
 * new index, since a block of a different size moves it.
 */
function spliceBlock(lines: string[], closing: number, key: string, newLines: string[]): number {
  const at = frontmatterLineOf(lines, closing, key);
  if (at >= 0) {
    let end = at + 1;
    while (end < closing && /^\s+\S/.test(lines[end])) end++;
    lines.splice(at, end - at);
    closing -= end - at;
  }
  if (newLines.length === 0) return closing;
  lines.splice(at >= 0 ? at : closing, 0, ...newLines);
  return closing + newLines.length;
}

/**
 * Splice `input` into `markdown`, textually — parsed and re-emitted for
 * nothing. A field present in `input` replaces the corresponding block in
 * place; a field new to the file is appended just above the closing `---`.
 * `body`, which is not frontmatter, replaces everything from the closing
 * marker to the end of the file. Returns `null` when there is no
 * frontmatter block to splice into, the caller's cue to leave a hand-shaped
 * file alone and say so.
 */
export function spliceCostsFields(markdown: string, input: CostsEditInput): string | null {
  const lines = markdown.split("\n");
  if (lines[0]?.trim() !== "---") return null;
  let closing = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
  if (closing < 0) return null;

  if (input.budget !== undefined) {
    closing = spliceBlock(lines, closing, "budget", budgetLines(input.budget));
  }
  if (input.costs !== undefined) {
    closing = spliceBlock(lines, closing, "costs", costsLines(input.costs));
  }
  if (input.body !== undefined) {
    lines.splice(closing + 1, lines.length - (closing + 1), "", input.body.trim(), "");
  }
  return lines.join("\n");
}

/**
 * The write just made, read back — or a sentence saying what is wrong with
 * it. Same instinct as `draftDoesNotReadBack` (lib/api/entries.ts, B208):
 * `quoteScalar` cannot emit YAML that fails to parse, but a budget can still
 * fail to parse as a *budget* — a zero total is exactly B263's failure, one
 * layer up from the validator that is supposed to have already refused it.
 */
function costsDoesNotReadBack(file: string, budgetWritten: CostsBudgetInput | null | undefined): string | null {
  let data: Record<string, unknown>;
  try {
    data = matter(fs.readFileSync(file, "utf8")).data;
  } catch (err) {
    const said = err instanceof Error ? err.message.split("\n")[0] : String(err);
    return `its frontmatter does not parse (${said})`;
  }
  if (budgetWritten && !parseBudget(data.budget)) {
    return "its budget does not read back — check that the total and days are both positive numbers";
  }
  return null;
}

/** Create or wholly replace a trip's costs.md — `PUT .../costs`. */
export function putCosts(ref: string, input: CostsFileInput): CostsWriteResult {
  const trip = getTrip(ref);
  if (!trip) return { ok: false, error: "unknown_trip" };

  const file = costsFilePath(ref);
  const lines = [
    "---",
    ...budgetLines(input.budget),
    ...costsLines(input.costs),
    "---",
    "",
    (input.body ?? "").trim(),
    "",
  ];

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.join("\n"));

  const unreadable = costsDoesNotReadBack(file, input.budget);
  if (unreadable) {
    return {
      ok: false,
      bug: true,
      error: `The costs page was written but ${unreadable}. This is a bug; please report it.`,
    };
  }
  return { ok: true };
}

/** Amend a trip's costs.md without resending the whole thing — `PATCH .../costs`. */
export function patchCosts(ref: string, input: CostsEditInput): CostsWriteResult {
  const trip = getTrip(ref);
  if (!trip) return { ok: false, error: "unknown_trip" };

  const file = costsFilePath(ref);
  if (!fs.existsSync(file)) {
    return {
      ok: false,
      error:
        `${ref} has no costs.md yet, so there is nothing to amend. PUT to this same URL to ` +
        "create one.",
    };
  }

  const raw = fs.readFileSync(file, "utf8");
  const spliced = spliceCostsFields(raw, input);
  if (spliced === null) {
    return { ok: false, error: "costs.md has no frontmatter block to edit. Edit the file by hand." };
  }

  try {
    matter(spliced);
  } catch (err) {
    const said = err instanceof Error ? err.message.split("\n")[0] : String(err);
    return {
      ok: false,
      bug: true,
      error: `The edit would leave costs.md unparseable (${said}), so nothing was written. This is a bug; please report it.`,
    };
  }

  fs.writeFileSync(file, spliced);

  const unreadable = costsDoesNotReadBack(file, input.budget);
  if (unreadable) {
    return {
      ok: false,
      bug: true,
      error: `The edit was written but ${unreadable}. This is a bug; please report it.`,
    };
  }
  return { ok: true };
}

/**
 * Remove a trip's costs.md entirely — `DELETE .../costs`.
 *
 * Whole-file, not just the `budget:` line: `hasCostsData` (lib/costs.ts,
 * B267) is what decides whether the costs page exists at all, and it asks
 * whether the file is there, not what is in it. Removing only the budget
 * would leave the file — and the page — behind with just preparation costs
 * on it, which is not what "the page is now gone" promises.
 */
export function deleteCosts(ref: string): { ok: true } | { ok: false; error: string } {
  const trip = getTrip(ref);
  if (!trip) return { ok: false, error: "unknown_trip" };

  const file = costsFilePath(ref);
  if (!fs.existsSync(file)) {
    return { ok: false, error: `${ref} has no costs.md — there is nothing to delete.` };
  }

  fs.rmSync(file);
  return { ok: true };
}
