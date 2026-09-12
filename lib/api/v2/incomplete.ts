// Turning a ZodError into the two v2 refusal bodies — B1596.
//
// Pure on purpose: no `server-only`, no fs, no next import. A route calls
// this after `schema.safeParse()` fails; nothing here needs to know what a
// request or a response is.
import type { ZodError, ZodType } from "zod";
import { z } from "zod";

/** One row of the `incomplete` body's `missing` list — see
 * `incompleteDetails` in ./schemas/shared.ts, which this must keep matching. */
export type MissingRow = {
  field: string;
  why_required: string;
  to_provide?: unknown;
  to_decline: string;
};

export type ProblemRow = { field: string; problem: string };

/**
 * The `params` bag a custom issue carries — `checkRequiredOrDeclined` and
 * `checkPatchConflicts` in ./schemas/shared.ts are the only things that set
 * it. Zod's `$ZodIssue` is a union and only its custom member declares
 * `params`, so reading it off the union needs this narrowing; a non-custom
 * issue simply has none, which is exactly the "not a missing section" answer
 * the callers below want.
 */
function v2Params(issue: unknown): { v2?: unknown; toDecline?: unknown } {
  return ((issue as { params?: unknown }).params ?? {}) as { v2?: unknown; toDecline?: unknown };
}

/**
 * Every issue `checkRequiredOrDeclined` raised (`params.v2 === "missing"`),
 * one row per field, first occurrence wins. `why_required` is the issue's own
 * message — that IS the whyRequired sentence the schema declared, not a
 * second copy of it. `to_provide` is generated from the section's own Zod
 * shape rather than typed beside it, so it cannot drift from what the schema
 * actually accepts; a field the caller did not hand a shape for is omitted
 * rather than guessed at.
 */
export function incompleteFrom(error: ZodError, shape: Record<string, ZodType>): { missing: MissingRow[] } {
  const missing: MissingRow[] = [];
  const seen = new Set<string>();
  for (const issue of error.issues) {
    const params = v2Params(issue);
    if (params.v2 !== "missing") continue;
    const field = String(issue.path[0]);
    if (seen.has(field)) continue;
    seen.add(field);
    const row: MissingRow = {
      field,
      why_required: issue.message,
      to_decline:
        typeof params.toDecline === "string" ? params.toDecline : `declined.${field}: <reason>`,
    };
    if (field in shape) {
      row.to_provide = z.toJSONSchema(shape[field], { io: "input", unrepresentable: "any" });
    }
    missing.push(row);
  }
  return { missing };
}

/**
 * Every OTHER issue — an ordinary validation problem, not a silent omission.
 * Lists ALL of them, never just the first: v1's `invalid_entry` convention
 * (lib/validate/entry.ts) is to report every field wrong in one round trip,
 * and v2 keeps that rather than making a caller fix-and-resubmit one at a
 * time.
 */
export function problemsFrom(error: ZodError): ProblemRow[] {
  return error.issues
    .filter((issue) => v2Params(issue).v2 !== "missing")
    .map((issue) => ({
      field: issue.path.length ? issue.path.join(".") : "(body)",
      problem: issue.message,
    }));
}

/**
 * Which refusal a route sends. At least one `missing` issue means this is
 * the 422 `incomplete` body — and if the same body is ALSO wrong in the
 * ordinary way, those problems ride along under an extra `problems` key
 * rather than being silently dropped (the incomplete envelope's `details` is
 * `z.unknown()` in the schema, so this is allowed shape-wise; `missing`
 * itself stays exactly the documented rows). No `missing` issue at all means
 * the ordinary invalid-request refusal, whose `details` IS `problems`.
 */
export function splitIssues(
  error: ZodError,
  shape: Record<string, ZodType>,
): { incomplete: { missing: MissingRow[]; problems?: ProblemRow[] } | null; problems: ProblemRow[] } {
  const { missing } = incompleteFrom(error, shape);
  const problems = problemsFrom(error);
  if (missing.length === 0) return { incomplete: null, problems };
  return {
    incomplete: problems.length > 0 ? { missing, problems } : { missing },
    problems,
  };
}
