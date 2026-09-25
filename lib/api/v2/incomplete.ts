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

// B1649 built `ANSWERED_ELSEWHERE` here for one declinable that named no
// real property of the document — `buddies`, added through the agent bearer
// invites door. B2297 (with B2295) retired both: `people:` is the byline
// only, a buddy is granted only from Studio › Readers, and there is nothing
// left for a "which door answers this section" pointer to name.

/**
 * Every issue `checkRequiredOrDeclined` raised (`params.v2 === "missing"`),
 * one row per field, first occurrence wins. `why_required` is the issue's own
 * message — that IS the whyRequired sentence the schema declared, not a
 * second copy of it. `to_provide` is generated from the section's own Zod
 * shape rather than typed beside it, so it cannot drift from what the schema
 * actually accepts; a field the caller did not hand a shape for is omitted
 * rather than guessed at.
 *
 * `declinableKeys` — B1668 — is the schema's own closed enum of what
 * `declined` actually accepts (`DECLINABLE_KEYS`/`DAY_DECLINABLE_KEYS`, or the
 * journal's inline list). A "missing" issue that names no explicit
 * `toDecline` param used to default, unconditionally, to
 * `declined.<field>: <reason>` — which is only true when `<field>` is really
 * in that enum. `teaser` is not (it is a plain required boolean on a closed
 * trip, refused as an unrecognised key if a caller actually sends
 * `declined.teaser`), so the guessed default was a refusal telling the
 * caller to do the one thing guaranteed to fail. A field outside the enum
 * gets a row that says so instead of a fabricated decline path.
 */
export function incompleteFrom(
  error: ZodError,
  shape: Record<string, ZodType>,
  declinableKeys: readonly string[],
): { missing: MissingRow[] } {
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
        typeof params.toDecline === "string"
          ? params.toDecline
          : declinableKeys.includes(field)
            ? `declined.${field}: <reason>`
            : `there is no decline for "${field}" — see why_required and to_provide`,
    };
    if (field in shape) {
      row.to_provide = z.toJSONSchema(shape[field], { io: "input", unrepresentable: "any" });
    }
    missing.push(row);
  }
  return { missing };
}

/** Lowercased with separators removed, so `transport_mode`, `TransportMode`
 * and `transport-mode` all collapse onto `transportmode` — B535's `fold`,
 * carried over from the deleted `lib/validate/body.ts` (B1677). */
function fold(key: string): string {
  return key.toLowerCase().replace(/[_-]/g, "");
}

/** Edit distance, capped: anything past `limit` is reported as `limit + 1`,
 * which is all the caller asks. */
function distance(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= b.length; j += 1) {
      row[j] = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = row;
    if (Math.min(...row) > limit) return limit + 1;
  }
  return previous[b.length];
}

/**
 * The field the caller probably meant, or null — B1703, restoring the half
 * of B535's `suggestField` that `problemsFrom` lost when v2 moved unknown-key
 * refusal onto `z.strictObject` (`lib/validate/body.ts` deleted under B1677).
 *
 * A case or separator difference wins outright — that is somebody writing
 * `transport_mode` from another API's habits, not a typo. Otherwise one edit
 * for a short name and two for a longer one, which catches `visibilty` and
 * `titel` without pairing `lat` with `lng`.
 */
function suggestField(key: string, known: readonly string[]): string | null {
  const folded = fold(key);
  const byFold = known.find((candidate) => fold(candidate) === folded);
  if (byFold) return byFold;

  const limit = key.length >= 6 ? 2 : 1;
  let best: string | null = null;
  let bestDistance = limit + 1;
  for (const candidate of known) {
    const d = distance(folded, fold(candidate), limit);
    if (d < bestDistance) {
      best = candidate;
      bestDistance = d;
    }
  }
  return bestDistance <= limit ? best : null;
}

/**
 * Every OTHER issue — an ordinary validation problem, not a silent omission.
 * Lists ALL of them, never just the first: v1's `invalid_entry` convention
 * (lib/validate/entry.ts) is to report every field wrong in one round trip,
 * and v2 keeps that rather than making a caller fix-and-resubmit one at a
 * time.
 *
 * `shape`, when given, is the schema's own top-level keys — the same object
 * `incompleteFrom` already receives. An `unrecognized_keys` issue (a
 * `z.strictObject`'s answer to a key it does not know) is checked against it
 * for a near miss and, when found, the suggestion rides along in the
 * message (B1703): `transport_mode` on a schema that has `transportMode`
 * names it rather than leaving the caller to re-read the docs.
 */
export function problemsFrom(error: ZodError, shape?: Record<string, ZodType>): ProblemRow[] {
  return error.issues
    .filter((issue) => v2Params(issue).v2 !== "missing")
    .map((issue) => {
      const problem = issue.message;
      if (issue.code === "unrecognized_keys" && shape) {
        const known = Object.keys(shape);
        const suggestions = issue.keys
          .map((key) => ({ key, suggestion: suggestField(key, known) }))
          .filter((s): s is { key: string; suggestion: string } => s.suggestion !== null);
        if (suggestions.length > 0) {
          const said = suggestions.map((s) => `did you mean "${s.suggestion}" instead of "${s.key}"?`).join(" ");
          return { field: issue.path.length ? issue.path.join(".") : "(body)", problem: `${problem} — ${said}` };
        }
      }
      return { field: issue.path.length ? issue.path.join(".") : "(body)", problem };
    });
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
  declinableKeys: readonly string[],
): { incomplete: { missing: MissingRow[]; problems?: ProblemRow[] } | null; problems: ProblemRow[] } {
  const { missing } = incompleteFrom(error, shape, declinableKeys);
  const problems = problemsFrom(error, shape);
  if (missing.length === 0) return { incomplete: null, problems };
  return {
    incomplete: problems.length > 0 ? { missing, problems } : { missing },
    problems,
  };
}
