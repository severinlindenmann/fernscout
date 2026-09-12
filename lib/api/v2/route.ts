// The plumbing every v2 route handler sits on — B1596.
//
// May import next/server; unlike incomplete.ts and schemas/shared.ts this is
// the layer that actually is a route.
import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { ERROR_CODES } from "../errorCodes";
import { formatV2RequestLine } from "../../requestLog";

/**
 * ponytail: these two codes are not yet in `ERROR_CODES`
 * (lib/api/errorCodes.ts). `test/openapi-contract.test.ts` fails on a code
 * that is here and answered by no route, and no v2 route exists yet to
 * answer either one — adding them now would be a red test with nothing to
 * point at. Add both to `ERROR_CODES` in the build step that ships the
 * first route actually answering them (phase 2 step 3 of the migration).
 * Until then this list is the contract's IOU: it is what `fail()` below is
 * allowed to send, ahead of what the published vocabulary allows.
 */
export const V2_ONLY_CODES = ["incomplete", "stale_document"] as const;

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
  missing_token: 401,
  invalid_token: 401,
  out_of_scope: 403,
  forbidden: 403,
  not_found: 404,
  method_not_allowed: 405,
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

function stableStringify(value: unknown): string {
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
  return !tags.some((t) => t === "*" || t === current);
}

/**
 * `dryRun` is a query parameter, not a body field, on purpose: every v2
 * write body is a `z.strictObject`, so an unknown key would be refused
 * rather than read — and a flag that changes whether bytes are written is
 * not part of the document being written anyway.
 */
export function isDryRun(request: Request): boolean {
  const url = new URL(request.url);
  const value = url.searchParams.get("dryRun");
  if (value === null) return false;
  return value === "" || value.toLowerCase() === "1" || value.toLowerCase() === "true";
}

/** Parses the body as JSON, never throwing — a malformed body is the
 * `invalid_json` refusal, not an unhandled exception. */
export async function readJson(request: Request): Promise<{ ok: true; value: unknown } | { ok: false; response: NextResponse }> {
  try {
    const value = await request.json();
    return { ok: true, value };
  } catch {
    return { ok: false, response: fail("invalid_json", ERROR_CODES.invalid_json) };
  }
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
