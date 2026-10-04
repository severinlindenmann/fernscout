// The handlers behind /api/v2/{user}/visited — B2914. The v2 routes (a bearer
// token) and the owner's own browser doors (`/api/web/{user}/visited…`, a
// cookie) both call these, so a country saved from the page and one saved by
// an agent are validated and read back identically. Authentication is the
// caller's; nothing here looks at who is asking.
import { getUser } from "../../users";
import { addVisit, deleteVisit, getVisit, putVisitPhoto, removeVisitPhoto, updateVisit, visitedDocOf, visibleVisit, visibleVisits, type VisitReader } from "../../visited";
import { fail, ok, readJson } from "./route";
import { problemsFrom } from "./incomplete";
import { ERROR_CODES } from "../errorCodes";
import { REQUEST_MAX_BYTES } from "../../validate/media";
import { countryCode, visitedBatch, visitedCreate, visitedPatch } from "./schemas/visited";

const noJournal = (user: string) => fail("no_such_journal", `No journal called "${user}".`, undefined, 404);

/** The code in the URL, folded and checked — or the refusal to send. */
function codeOr400(raw: string): { code: string } | { response: Response } {
  const parsed = countryCode.safeParse(raw);
  if (!parsed.success) {
    return { response: fail("invalid_request", `"${raw}" is not a country code the map knows. Use two letters, e.g. NO.`) };
  }
  return { code: parsed.data.toUpperCase() };
}

const missing = (code: string) => fail("not_found", `No country ${code} recorded without a trip.`, undefined, 404);

export function applyVisitedList(user: string, reader: VisitReader): Response {
  if (!getUser(user)) return noJournal(user);
  return ok({ visited: visibleVisits(user, reader).map((e) => visitedDocOf(user, e)) });
}

export function applyVisitedGet(user: string, rawCode: string, reader: VisitReader): Response {
  if (!getUser(user)) return noJournal(user);
  const c = codeOr400(rawCode);
  if ("response" in c) return c.response;
  const entry = visibleVisit(user, c.code, reader);
  return entry ? ok(visitedDocOf(user, entry)) : missing(c.code);
}

/**
 * One country (`{country, …}`) or many (`{entries: [...]}`). A country that
 * already has an entry answers with that entry as it stands: 200 for one, and
 * absent from `created` for a batch. Nothing is overwritten.
 */
export async function applyVisitedCreate(user: string, request: Request): Promise<Response> {
  if (!getUser(user)) return noJournal(user);
  const body = await readJson(request);
  if (!body.ok) return body.response;
  const isBatch = typeof body.value === "object" && body.value !== null && "entries" in body.value;

  if (isBatch) {
    const parsed = visitedBatch.safeParse(body.value);
    if (!parsed.success) {
      return fail("invalid_request", "This batch is not usable.", { problems: problemsFrom(parsed.error) });
    }
    const created: string[] = [];
    const entries = parsed.data.entries.map((input) => {
      const result = addVisit(user, input);
      if (result.created) created.push(result.entry.country);
      return visitedDocOf(user, result.entry);
    });
    return ok({ entries, created });
  }

  const parsed = visitedCreate.safeParse(body.value);
  if (!parsed.success) {
    return fail("invalid_request", "This entry is not usable.", { problems: problemsFrom(parsed.error) });
  }
  const result = addVisit(user, parsed.data);
  return ok(visitedDocOf(user, result.entry), { status: result.created ? 201 : 200 });
}

export async function applyVisitedPatch(user: string, rawCode: string, request: Request): Promise<Response> {
  if (!getUser(user)) return noJournal(user);
  const c = codeOr400(rawCode);
  if ("response" in c) return c.response;
  const body = await readJson(request);
  if (!body.ok) return body.response;
  const parsed = visitedPatch.safeParse(body.value);
  if (!parsed.success) {
    return fail("invalid_request", "This change is not usable.", { problems: problemsFrom(parsed.error) });
  }
  const result = updateVisit(user, c.code, parsed.data);
  if (result === null) return missing(c.code);
  if (result === "month_needs_year") {
    return fail("invalid_request", "A month needs a year.", { problems: [{ field: "month", problem: "a month needs a year" }] });
  }
  return ok(visitedDocOf(user, result));
}

export function applyVisitedDelete(user: string, rawCode: string): Response {
  if (!getUser(user)) return noJournal(user);
  const c = codeOr400(rawCode);
  if ("response" in c) return c.response;
  return deleteVisit(user, c.code) ? ok({ deleted: c.code }) : missing(c.code);
}

/** `multipart/form-data`, the bytes under `file`. Replaces any photograph the
 * entry already has; the original of the old one is kept. */
export async function applyVisitedPhotoPut(user: string, rawCode: string, request: Request): Promise<Response> {
  if (!getUser(user)) return noJournal(user);
  const c = codeOr400(rawCode);
  if ("response" in c) return c.response;
  if (!getVisit(user, c.code)) return missing(c.code);

  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > REQUEST_MAX_BYTES) {
    return fail("body_too_large", ERROR_CODES.body_too_large, undefined, 413);
  }
  const form = await request.formData().catch(() => null);
  if (!form) return fail("expected_multipart", ERROR_CODES.expected_multipart, undefined, 400);
  const file = form.get("file");
  if (!(file instanceof File)) {
    return fail("expected_multipart", `${ERROR_CODES.expected_multipart} Send bytes under \`file\`.`, undefined, 400);
  }

  const result = await putVisitPhoto(user, c.code, { filename: file.name, bytes: Buffer.from(await file.arrayBuffer()) });
  if (result.ok) return ok(visitedDocOf(user, result.entry));
  if (result.error === "no_entry") return missing(c.code);
  if (result.error === "storage_full") return fail("storage_full", result.problem, undefined, 400);
  return fail("invalid_media", ERROR_CODES.invalid_media, result.problems, 400);
}

export function applyVisitedPhotoDelete(user: string, rawCode: string): Response {
  if (!getUser(user)) return noJournal(user);
  const c = codeOr400(rawCode);
  if ("response" in c) return c.response;
  const entry = removeVisitPhoto(user, c.code);
  return entry ? ok(visitedDocOf(user, entry)) : missing(c.code);
}
