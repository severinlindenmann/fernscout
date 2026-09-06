import "server-only";
import { checkBody, type BodyCheck, type Schema } from "@/lib/validate/body";
import { openApiDocument } from "./openapi";

/**
 * Checking a request body against the contract this instance publishes.
 *
 * B535 built the checker and left it unwired, because the two routes it had to
 * touch were open in other sessions. B540 is why it could not stay that way.
 * An agent working only from `/openapi.json` was asked to create a journal and
 * did this:
 *
 *     POST /api/v1/<user>/trips
 *     { "id": "…", "title": "…", "start": "…", "end": "…", "visibilty": "private" }
 *     → 201 Created, and a trip that is PUBLIC
 *
 * One transposed letter, no refusal, and a trip advertised in the sitemap, the
 * feed and the switcher when the caller had asked for the opposite. The value
 * side of that field is carefully safe — an unrecognised *value* falls back to
 * private, never to public, because a typo must not publish somebody's trip
 * (see `lib/trips.ts`). The key side had no such care and failed the other
 * way. That asymmetry is the whole reason this module exists.
 *
 * The schema is the document at `/openapi.json`, not a second list written
 * here: a field added there is documented, rendered at /docs/api and enforced
 * in one edit, and a field added anywhere else is refused loudly on its first
 * call rather than dropped quietly on every call.
 */

/**
 * The document is rebuilt from constants on every call and does not change
 * between requests. Built once here because this now runs on the write path,
 * where a caller is waiting.
 *
 * Not `clearCache`-able on purpose: nothing in it reads a journal's own files,
 * so there is no staleness for a cache to cause.
 */
let cached: ReturnType<typeof openApiDocument> | null = null;

function document(): ReturnType<typeof openApiDocument> | null {
  if (cached) return cached;
  try {
    cached = openApiDocument();
    return cached;
  } catch {
    // The document is built from the site config, which can be unreadable —
    // /api/health reports that as a fault. It must not also take writes down:
    // a caller whose body is fine is not the person to tell about it.
    return null;
  }
}

/**
 * Check a body against the published request schema for one operation.
 *
 * Answers `{ problems, warnings }`. An operation this document does not
 * describe, or a document that would not build, comes back as a warning and
 * never as a refusal — `test/openapi-contract.test.ts` is what makes sure that
 * case does not exist, and it is the wrong place to find out.
 */
export function checkAgainstContract(path: string, verb: string, body: unknown): BodyCheck {
  const doc = document() as unknown as {
    paths?: Record<string, Record<string, { requestBody?: { content?: Record<string, { schema?: Schema }> } }>>;
    components?: { schemas?: Record<string, Schema> };
  } | null;
  const schema = doc?.paths?.[path]?.[verb]?.requestBody?.content?.["application/json"]?.schema;
  return checkBody(body, schema ?? null, doc?.components?.schemas);
}

/**
 * Shape problems worth adding to a list a specialised validator has already
 * filled in.
 *
 * A field both of them object to is reported once, by the one that knows the
 * field: `validateEntry` says "date is 2026-02-30, expected a real calendar
 * date" where this can only say "date is a string". Two entries for one
 * mistake reads as a bug in the API.
 */
export function alsoWrong(existing: { field: string }[], shape: BodyCheck): typeof shape.problems {
  return shape.problems.filter((p) => !existing.some((q) => q.field === p.field));
}
