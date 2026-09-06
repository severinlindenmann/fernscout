// Checks a request body against the schema the API already publishes.
//
// Pure, like the rest of lib/validate: no fs, no "server-only". It is handed
// a schema object and a parsed body and answers with the same `Problem` shape
// every other validator here produces, so a route can concatenate the two
// lists and answer with one.
//
// ## Why this exists
//
// Every write route in this codebase reads the keys it knows about and
// ignores the rest. `POST /api/v1/<user>/trips` reads its body as
// `Record<string, unknown>` and picks out the fields it recognises;
// `validateEntry` checks the fields it knows and never looks at the others.
// So a body carrying `visibilty` — or `transport_mode`, or `body` where
// `content` was meant — is accepted, answered 201, and the field is gone. The
// caller is told it worked. B535.
//
// ## Where the schema comes from
//
// `lib/api/openapi.ts` — the document served at `/openapi.json` and rendered
// at `/docs/api`. It is not a second copy of the field list written for this
// checker: it is the contract the instance already promises, and running it
// is the point. A field added there is documented, rendered and enforced in
// one edit; a field added anywhere else is refused, loudly, on its first call
// rather than silently dropped on every call.
//
// ## Top level only
//
// This checks the body's own keys, the `required` list, and the type and
// `enum` of each top-level value. It does not descend into `costs[]`,
// `translations{}` or `people[]` — `lib/validate/entry.ts` and
// `lib/validate/costs.ts` already check those, in far better words, and two
// validators reporting one mistake twice reads as a bug in the API.
//
// A route that has a specialised validator therefore runs both and drops any
// shape problem naming a field the specialised one already named:
//
//     problems.push(
//       ...shape.problems.filter((p) => !problems.some((q) => q.field === p.field)),
//     );
//
// ponytail: hand-rolled over the subset of JSON Schema this document actually
// uses — `type`, `properties`, `required`, `enum`, `$ref`,
// `additionalProperties`. If the published schemas ever need `oneOf`,
// `allOf`, `pattern` or real nested validation, throw this away and take ajv
// rather than growing it a clause at a time.
import { describe, type Problem } from "./entry";

/** The slice of JSON Schema `lib/api/openapi.ts` is written in. */
export type Schema = {
  $ref?: string;
  type?: string;
  properties?: Record<string, Schema>;
  required?: string[];
  enum?: unknown[];
  /** `false` is the default here, and deliberately the opposite of JSON
   * Schema's: a route that genuinely takes free-form keys says so by setting
   * this `true`, and gets warnings instead of refusals. */
  additionalProperties?: boolean;
};

export type BodyCheck = {
  /** Refusals. A non-empty list is a 400 and nothing is written. */
  problems: Problem[];
  /**
   * Said, never enforced. A route whose schema has not been written yet
   * (B536) lands here rather than in `problems`: a gap in the documentation
   * must not take writes down, and it must not pass in silence either.
   */
  warnings: Problem[];
};

/** Resolve `#/components/schemas/Draft` against the document's own schemas. */
function resolve(schema: Schema, schemas: Record<string, Schema> | undefined): Schema {
  let current = schema;
  // A $ref chain in a hand-written document is a mistake, but an unbounded
  // loop over one is a hang. Three hops is more than this document uses.
  for (let hop = 0; hop < 3 && current.$ref; hop += 1) {
    const name = current.$ref.split("/").pop();
    const target = name ? schemas?.[name] : undefined;
    if (!target) return current;
    current = target;
  }
  return current;
}

/** True when `value` matches a JSON Schema `type` keyword. */
/** "a string", "an array" — the refusals are read by people as often as by
 * programs, and "a array" reads as a bug in the validator. */
function article(type: string): string {
  return /^[aeiou]/.test(type) ? `an ${type}` : `a ${type}`;
}

function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "array":
      return Array.isArray(value);
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    default:
      // A type this checker does not know is not a reason to refuse a body.
      return true;
  }
}

/** Lowercased with separators removed, so `transport_mode`, `TransportMode`
 * and `transport-mode` all collapse onto `transportmode`. */
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
      row[j] = Math.min(
        previous[j] + 1,
        row[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = row;
    if (Math.min(...row) > limit) return limit + 1;
  }
  return previous[b.length];
}

/**
 * The field the caller probably meant, or null.
 *
 * A case or separator difference wins outright — that is somebody writing
 * `transport_mode` from another API's habits, not a typo. Otherwise one edit
 * for a short name and two for a longer one, which catches `visibilty` and
 * `titel` without pairing `lat` with `lng`.
 *
 * This is the half that makes the refusal worth having: "unknown field
 * `visibilty`" leaves an agent to re-read the docs, "did you mean
 * `visibility`?" ends it.
 */
export function suggestField(key: string, known: readonly string[]): string | null {
  const folded = fold(key);
  const others = known.filter((candidate) => candidate !== key);
  const byFold = others.find((candidate) => fold(candidate) === folded);
  if (byFold) return byFold;

  const limit = key.length >= 6 ? 2 : 1;
  let best: string | null = null;
  let bestDistance = limit + 1;
  for (const candidate of others) {
    const d = distance(folded, fold(candidate), limit);
    if (d < bestDistance) {
      best = candidate;
      bestDistance = d;
    }
  }
  return bestDistance <= limit ? best : null;
}

/** A readable list of what the endpoint takes, for the `expected` line. */
function accepted(known: readonly string[]): string {
  return known.length > 0
    ? `one of the fields this endpoint accepts: ${known.join(", ")}`
    : "no fields — this endpoint takes an empty body";
}

/**
 * Check a parsed body against a published schema.
 *
 * `schemas` is the document's `components.schemas`, so a `$ref` at the top
 * level resolves. Pass `null` for a route whose schema has not been written:
 * the answer is a warning, never a refusal.
 */
export function checkBody(
  body: unknown,
  schema: Schema | null | undefined,
  schemas?: Record<string, Schema>,
): BodyCheck {
  const problems: Problem[] = [];
  const warnings: Problem[] = [];

  const unchecked = (): BodyCheck => ({
    problems: [],
    warnings: [
      {
        field: "(body)",
        got: describe(body),
        expected: "a schema for this endpoint in lib/api/openapi.ts",
        hint:
          "This endpoint publishes no request schema, so its body was accepted without being " +
          "checked. That is a gap in the documentation rather than anything wrong with this " +
          "request — see B536.",
      },
    ],
  });

  if (!schema) return unchecked();

  const resolved = resolve(schema, schemas);
  // A $ref that named nothing. Refusing every field against an empty schema
  // would turn one typo in the document into a route that accepts no body at
  // all, so this is the same answer as no schema: say so, check nothing.
  if (resolved.$ref) return unchecked();

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    problems.push({
      field: "(body)",
      got: describe(body),
      expected: "a JSON object",
    });
    return { problems, warnings };
  }

  const properties = resolved.properties ?? {};
  const known = Object.keys(properties);
  const sent = body as Record<string, unknown>;

  for (const key of Object.keys(sent)) {
    if (key in properties) continue;
    const suggestion = suggestField(key, known);
    const problem: Problem = {
      field: key,
      got: describe(sent[key]),
      expected: accepted(known),
      hint: suggestion
        ? `No field is called ${JSON.stringify(key)} — did you mean ${JSON.stringify(suggestion)}? ` +
          "It was not written, and nothing else about this request was changed."
        : `No field is called ${JSON.stringify(key)}, so it was not written. Send only the ` +
          "fields above; an omitted field is better than an invented one.",
    };
    if (resolved.additionalProperties === true) warnings.push(problem);
    else problems.push(problem);
  }

  for (const key of resolved.required ?? []) {
    if (sent[key] !== undefined) continue;
    const required = properties[key]?.type;
    problems.push({
      field: key,
      got: "nothing",
      expected: required ? article(required) : "a value",
      hint: `${key} is required.`,
    });
  }

  for (const [key, property] of Object.entries(properties)) {
    const value = sent[key];
    if (value === undefined) continue;
    if (property.type && !matchesType(value, property.type)) {
      problems.push({
        field: key,
        got: describe(value),
        expected: article(property.type),
      });
      continue;
    }
    if (property.enum && !property.enum.includes(value)) {
      problems.push({
        field: key,
        got: describe(value),
        expected: `one of ${property.enum.map((v) => JSON.stringify(v)).join(", ")}`,
      });
    }
  }

  return { problems, warnings };
}
