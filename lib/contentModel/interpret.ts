// A minimal interpreter for the eight `assert` kinds in
// `lib/contentModel/types.ts` — test-only. Its one job is to let
// `test/content-model.test.ts` run `content-model.json`'s rules over the same
// fixtures `lib/validate/*` runs over, and compare what each one says.
//
// This is deliberately not what a real client uses. A real client (the
// helper, or the one this server eventually ships — B609) is trusted to run
// against a document fetched from a stranger's instance and has to defend
// itself accordingly; this one only ever runs against rules this repository
// just built two files away, so it is written for clarity over defence. Do
// not import this outside `test/`.
import type { Rule } from "./types";

export type InterpretedProblem = { path: string; message: string };

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "array":
      return Array.isArray(value);
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    default:
      return false;
  }
}

/** Read `path` off `doc` — dotted, no wildcard. `""` is the document itself. */
function get(doc: Record<string, unknown>, path: string): { present: boolean; value: unknown } {
  if (path === "") return { present: true, value: doc };
  let current: unknown = doc;
  for (const segment of path.split(".")) {
    if (typeof current !== "object" || current === null || Array.isArray(current)) {
      return { present: false, value: undefined };
    }
    const container = current as Record<string, unknown>;
    if (!(segment in container)) return { present: false, value: undefined };
    current = container[segment];
  }
  return { present: true, value: current };
}

/**
 * Run one rule against `doc` — a plain object standing in for a file's own
 * frontmatter (or `config.json` itself). Returns the problems this rule
 * finds, same as `lib/validate/*` would for the field it names.
 *
 * `never-in-file` and `never-over-api` are about which side of the API a key
 * may cross, not about a value's shape, so interpreting them against a file
 * fixture only ever asks "is this key present" — `never-in-file` fires when
 * it is (a file carrying an API-only key is describing a call), and
 * `never-over-api` never fires here at all, because a file is exactly where
 * a file-only key belongs. Comparing *that* half of the contract against
 * `openapi.json` is what `test/content-model.test.ts` does separately, with
 * `crosscheckAgainstOpenApi` below — a fixture object has no opinion on it.
 */
function interpretRule(rule: Rule, doc: Record<string, unknown>): InterpretedProblem[] {
  const { present, value } = get(doc, rule.path);
  const problems: InterpretedProblem[] = [];
  const path = rule.path || "(root)";

  switch (rule.assert) {
    case "required":
      if (!present || value === undefined) problems.push({ path, message: `${path} is required` });
      return problems;

    case "type":
      if (present && value !== undefined && !matchesType(value, rule.type)) {
        problems.push({ path, message: `${path} must be a ${rule.type}, got ${typeOf(value)}` });
      }
      return problems;

    case "enum":
      if (present && value !== undefined && !rule.values.includes(value as string | number | boolean)) {
        problems.push({ path, message: `${path} must be one of ${rule.values.join(", ")}` });
      }
      return problems;

    case "pattern":
      if (present && typeof value === "string" && !new RegExp(rule.pattern).test(value)) {
        problems.push({ path, message: `${path} must match ${rule.pattern}` });
      }
      return problems;

    case "shape": {
      // "This object's named members have these types" — per
      // lib/contentModel/types.ts. `path` is the map (e.g. `features.*`);
      // `member` is each of ITS members (e.g. `postcards`); `rule.members`
      // names the flat, one-level shape every one of THOSE member objects
      // must have (e.g. `{ enabled: "boolean" }`, for `features.postcards`).
      // A member that is not shaped like an object at all (`postcards: true`)
      // fails every field `rule.members` names — there is nothing to read
      // `enabled` off, so every declared field is as absent as if the object
      // were empty.
      if (!path.endsWith(".*")) throw new Error(`shape rule at ${path} did not end in the wildcard`);
      const mapPath = path.slice(0, -2);
      const { value: map } = get(doc, mapPath);
      if (typeof map !== "object" || map === null || Array.isArray(map)) return problems;
      for (const [member, memberValue] of Object.entries(map as Record<string, unknown>)) {
        const isShapedObject = typeof memberValue === "object" && memberValue !== null && !Array.isArray(memberValue);
        for (const [field, type] of Object.entries(rule.members)) {
          const fieldValue = isShapedObject ? (memberValue as Record<string, unknown>)[field] : undefined;
          if (!matchesType(fieldValue, type)) {
            problems.push({
              path: `${mapPath}.${member}.${field}`,
              message: `${mapPath}.${member}.${field} must be a ${type}`,
            });
          }
        }
      }
      return problems;
    }

    case "known-key": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) return problems;
      for (const key of Object.keys(value as Record<string, unknown>)) {
        if (!rule.keys.includes(key)) {
          problems.push({ path: path === "(root)" ? key : `${path}.${key}`, message: `unknown key ${key}` });
        }
      }
      return problems;
    }

    case "never-in-file":
      if (present && value !== undefined) {
        problems.push({ path, message: `${path} is a call parameter and must not be written to a file` });
      }
      return problems;

    case "never-over-api":
      // See the function comment: a file fixture has nothing to say here.
      return problems;

    default: {
      const exhaustive: never = rule;
      throw new Error(`unhandled assert kind: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/** Every problem every rule for `where` finds in `doc`. */
export function interpretFile(rules: readonly Rule[], where: Rule["where"], doc: Record<string, unknown>): InterpretedProblem[] {
  return rules.filter((rule) => rule.where === where).flatMap((rule) => interpretRule(rule, doc));
}
