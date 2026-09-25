// The plumbing every v2 route handler sits on — B1596.
//
// May import next/server; unlike incomplete.ts and schemas/shared.ts this is
// the layer that actually is a route.
import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { ERROR_CODES } from "../errorCodes";
import { JSON_BODY_MAX_BYTES, jsonBodyTooLargeMessage, readBoundedJson } from "../jsonBody";
import { formatV2RequestLine } from "../../requestLog";

/**
 * The IOU paid — B1608, phase 2 step 3. `incomplete` and `stale_document`
 * were deliberately absent from `lib/api/errorCodes.ts` until a route
 * existed to answer them (`test/openapi-contract.test.ts` fails on a code
 * that is here and answered by no route); `app/api/v2/[user]/route.ts`'s
 * `PATCH` is the first, so both are in `ERROR_CODES` now and this list is
 * empty. `test/api-v2-route.test.ts`'s `V2_ONLY_CODES` suite asserts the
 * emptiness rather than only leaving the comment to say so.
 */
export const V2_ONLY_CODES = [] as const;

export type V2ErrorCode = keyof typeof ERROR_CODES | (typeof V2_ONLY_CODES)[number];

/**
 * HTTP status per code — only the ones the plumbing itself answers with.
 * Not a copy of all 150 v1 codes: a route that needs a different status for
 * one of its own codes passes it explicitly to `fail()` rather than this map
 * growing an entry per route. Anything not listed here defaults to 400.
 */
export const V2_STATUS: Record<string, number> = {
  invalid_json: 400,
  invalid_request: 400,
  incomplete: 422,
  stale_document: 409,
  conflict: 409,
  missing_token: 401,
  invalid_token: 401,
  out_of_scope: 403,
  forbidden: 403,
  not_found: 404,
  body_too_large: 413,
  too_many_requests: 429,
};

/** The one error envelope every v2 refusal answers with. */
export function fail(code: V2ErrorCode, message: string, details?: unknown, status?: number): NextResponse {
  const body: { error: string; message: string; details?: unknown } = { error: code, message };
  if (details !== undefined) body.details = details;
  return NextResponse.json(body, { status: status ?? V2_STATUS[code] ?? 400 });
}

/** A success. Sets `ETag` when one is given, so a caller wanting the
 * If-Match dance never has to reach past this helper to get it on. */
export function ok(
  body: unknown,
  init?: { status?: number; etag?: string; headers?: Record<string, string> },
): NextResponse {
  const headers = new Headers(init?.headers);
  if (init?.etag) headers.set("ETag", init.etag);
  return NextResponse.json(body, { status: init?.status ?? 200, headers });
}

/**
 * A strong ETag over a document — sha256 of the JSON, keys sorted at every
 * level so key order (which JS makes no promise about across a read-modify-
 * write) can never change the tag on an unchanged document.
 */
export function etagFor(doc: unknown): string {
  const hash = createHash("sha256").update(stableStringify(doc)).digest("hex").slice(0, 32);
  return `"${hash}"`;
}

/**
 * `Object.keys(new Date(...))` is `[]` — a `Date` has no *own enumerable
 * properties*, its value lives in an internal slot — so without this check
 * every `Date`, whatever instant it holds, stringified as `{}` and two
 * documents differing only in a date collided on one ETag (B1601, V11). Not
 * reachable through this module's own callers today: `JSON.parse` never
 * manufactures a `Date` on its own, so `dayFromJson`/`tripFromJson` cannot
 * hand one back the way the old YAML-backed `dayFromMarkdown` could from an
 * unquoted `date: 2026-09-12`. Kept anyway — a caller building a document
 * in memory before it ever reaches disk (a route handler assembling a
 * response, a test fixture) can still construct one, and the collision is
 * silent when it happens.
 */
function stableStringify(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * True when the request carries `If-Match` and it does not cover `current`
 * — a comma-separated list, or `*`, which always matches. No header at all
 * is never stale: last-write-wins is the documented default, and a caller
 * that cares sends `If-Match` to opt into the check. A caller that finds
 * this true answers `fail("stale_document", ..., { current: <the current
 * document> }, 409)` — the current document goes in the refusal itself, so
 * there is no separate helper that has to be handed the whole document just
 * to decide whether it is stale.
 */
export function ifMatchStale(request: Request, current: string): boolean {
  const header = request.headers.get("if-match");
  if (!header) return false;
  const tags = header.split(",").map((t) => t.trim());
  return !tags.some((t) => t === "*" || t === current || withoutProxyEncoding(t) === current);
}

/**
 * The ETag as this server issued it, with a compressing proxy's own suffix
 * taken back off — B1729.
 *
 * Caddy's `encode` (deploy/fernscout.caddy) appends `-gzip` to the ETag of
 * anything it compresses, and every HTTP client sends `accept-encoding: gzip`
 * without being asked — `fetch` does it by default. So the value a caller
 * reads back is `"<hash>-gzip"`, the value this server compares against is
 * `"<hash>"`, and **every conditional write fails**: `409 stale_document` on a
 * document nobody else has touched, with a message that states confidently
 * that somebody has. Since v2 made `If-Match` the only way to replace a trip,
 * a day or a figure, that is the entire conditional-write surface. The one
 * kind of client not affected is the one that sends no `accept-encoding`,
 * which is a hand-written `curl` — so it looked fine in every check made by
 * hand and failed for the first real program that tried it.
 *
 * **Suffix-appending is correct for `If-None-Match` and wrong for
 * `If-Match`.** A gzipped body genuinely is a different representation, so a
 * cache validator must distinguish them; `If-Match` on a write asks about the
 * state of the *resource*, which no content coding changes. This is the write
 * path, so the suffix is removed here rather than anywhere Caddy can see —
 * which also means it is fixed for any proxy that does the same thing, not
 * just the one in front of this instance today.
 *
 * Narrow on purpose: the original tag is still tried first and unmodified, so
 * this can only ever accept a header it previously refused. Every ETag this
 * server issues is a quoted hex hash (`etagFor`), so none of them can end in
 * one of these names and lose a character to this.
 */
function withoutProxyEncoding(tag: string): string {
  return tag.replace(/-(gzip|br|zstd|deflate|compress)("?)$/, "$2");
}

/**
 * `dryRun` is a query parameter, not a body field, on purpose: every v2
 * write body is a `z.strictObject`, so an unknown key would be refused
 * rather than read — and a flag that changes whether bytes are written is
 * not part of the document being written anyway.
 *
 * `true` = preview, `false` = write, `null` = the caller said something this
 * cannot read. `null` is not a default — T1 exists precisely so a caller who
 * asked for a preview can never silently get a write instead, and guessing
 * at an unrecognised value is exactly that risk in the other direction.
 * `URLSearchParams.get("dryRun")` alone missed `?dryrun=1` (case) and could
 * not distinguish "no header" from "invalid", both reading as `false` — the
 * asymmetry this replaces `isDryRun` to close (B1601, the second serious
 * finding). The caller answers a `null` with `fail("invalid_request", …)`
 * rather than treating it as either state.
 */
export function readDryRun(request: Request): boolean | null {
  const url = new URL(request.url);
  const values = new Set<string>();
  for (const [key, value] of url.searchParams) {
    if (key.toLowerCase() === "dryrun") values.add(value.toLowerCase());
  }
  if (values.size === 0) return false;
  if (values.size > 1) return null; // given twice with disagreeing values
  const value = [...values][0];
  if (["", "1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  return null;
}

/**
 * V12 cursor pagination for a list already held in memory, in a fixed order.
 * `cursor` is the `id` of the last item the caller already has; the next page
 * starts right after it in `all`'s own order, so this works for any list
 * order (ascending, or newest-first like `listInvites`/`listContacts`) as
 * long as it does not change between calls. An unrecognised cursor (the row
 * was deleted, or the id is invented) starts from the top rather than
 * refusing — a caller that already fell behind gets a page rather than an
 * error over something it cannot fix.
 */
export function paginate<T>(
  all: T[],
  opts: { limit: number; cursor?: string },
  idOf: (item: T) => string,
): { items: T[]; nextCursor?: string } {
  const from = opts.cursor ? Math.max(0, all.findIndex((item) => idOf(item) === opts.cursor) + 1) : 0;
  const items = all.slice(from, from + opts.limit);
  const nextCursor = from + opts.limit < all.length ? idOf(items[items.length - 1]) : undefined;
  return { items, nextCursor };
}

/** Parses the body as JSON, never throwing — a malformed body is the
 * `invalid_json` refusal, not an unhandled exception, and one over
 * `JSON_BODY_MAX_BYTES` is `body_too_large` (413, B2243) before it is all
 * read. */
export async function readJson(request: Request): Promise<{ ok: true; value: unknown } | { ok: false; response: NextResponse }> {
  const read = await readBoundedJson(request);
  if (read.tooLarge) {
    return {
      ok: false,
      response: fail("body_too_large", jsonBodyTooLargeMessage(JSON_BODY_MAX_BYTES), { maxBytes: JSON_BODY_MAX_BYTES }, 413),
    };
  }
  if (read.value === undefined) return { ok: false, response: fail("invalid_json", ERROR_CODES.invalid_json) };
  return { ok: true, value: read.value };
}

/**
 * One line per v2 call, metadata only — never a body, never a query string
 * — logged only when the caller has already resolved `features.logging` is
 * on (the same one config read `proxy.ts`'s own `loggingEnabled()` does; see
 * its comment for why this module takes the boolean rather than resolving it
 * itself: asking `lib/capabilities.ts` directly would pull `server-only` into
 * a file routes import for far more than logging). Never throws — a log
 * line lost is not worth trading a response for.
 */
export function logV2Request(fields: {
  method: string;
  path: string;
  status: number;
  ms: number;
  token: string | null;
  journal: string | null;
  enabled: boolean;
}): void {
  if (!fields.enabled) return;
  try {
    console.log(formatV2RequestLine(fields));
  } catch {
    // never let a log line take down a response
  }
}
