// GET/POST /api/v2/{user}/import — ports app/api/v1/[user]/import/route.ts
// onto the v2 plumbing. Domain logic (which importer, whether it holds up,
// what goes on disk) is unchanged in lib/gps/api.ts and
// lib/contacts/readImport.ts; a bank statement already moved to
// /api/v2/{user}/media + /api/v2/{user}/statements/{src} in B1624, so this
// door only ever answers for `gps` and `contacts` — see lib/gps/api.ts's own
// note on `IMPORT_KINDS`.
//
// `dryRun` is a v2 query parameter (readDryRun), not a body field, matching
// every other v2 write — see lib/api/v2/route.ts's own comment on why.
import fs from "node:fs";
import { requireJournalOwner } from "@/lib/api/v2/auth";
import { fail, ok, readDryRun } from "@/lib/api/v2/route";
import { ERROR_CODES } from "@/lib/api/errorCodes";
import { findInboxFile } from "@/lib/inbox";
import {
  IMPORT_KINDS,
  importFormats,
  importGps,
  isRefusal,
  type ImportKind,
} from "@/lib/gps/api";
import { readContactsFile } from "@/lib/contacts/readImport";
import { storageRefusal, withStorageQuota } from "@/lib/storageQuota";
import { getUser } from "@/lib/users";
import { REQUEST_MAX_BYTES } from "@/lib/validate/media";

export const dynamic = "force-dynamic";

/**
 * Importing somebody's own data — one door, keyed by `kind` (what the data
 * *is*) and `format` (who wrote it).
 *
 * **`gps` ends differently from `contacts`, and that is the rule this
 * migration preserves exactly.** Positions are written into the journal's
 * store as they are read — a coordinate is a measurement, and there is
 * nothing about it to decide. A vCard is read and *reported*: nothing
 * becomes a contact until agreed rows are sent to
 * `POST /api/v2/{user}/contacts/import`, the same door v1 always used for
 * that half. Owner only: a location history and a phone's own address book
 * both belong to the whole journal, not to one trip.
 */
export async function GET(request: Request, { params }: RouteContext<"/api/v2/[user]/import">) {
  const { user } = await params;
  const auth = await requireJournalOwner(request, user);
  if (!auth.ok) return auth.response;

  return ok({
    user,
    kinds: importFormats(),
    maxBytes: REQUEST_MAX_BYTES,
    next:
      `Stage the export with \`POST /api/v2/${user}/media\` — \`intent\` names the kind ` +
      "(`gps_history` for a location history) — then " +
      `\`POST /api/v2/${user}/import\` with \`{"kind": "…", "inbox": "<the id from that upload>"}\`. ` +
      "Say the kind; leave `format` out and the file is recognised from its own contents. " +
      `A \`gps\` import is stored as it is read, and \`POST /api/v2/${user}/trips/<trip>/track\` ` +
      "then draws one trip's line from it. A `contacts` import (a vCard) writes nothing: it " +
      "reports who was on the card, you agree who is actually a contact, and " +
      `\`POST /api/v2/${user}/contacts/import\` files the agreed rows, each pending its own ` +
      "confirmation mail.",
  });
}

type Body = {
  kind?: unknown;
  format?: unknown;
  inbox?: unknown;
  text?: unknown;
};

/** The bytes, from whichever of the three doors was used. */
async function bytesFrom(
  request: Request,
  user: string,
): Promise<{ text: string; filename: string; body: Body } | { error: ReturnType<typeof fail> }> {
  const type = request.headers.get("content-type") ?? "";

  if (type.startsWith("multipart/form-data")) {
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!form || !(file instanceof File)) {
      return { error: fail("expected_file", ERROR_CODES.expected_file, undefined, 400) };
    }
    return {
      text: await file.text(),
      filename: file.name || "upload",
      body: { kind: form.get("kind") ?? undefined, format: form.get("format") ?? undefined },
    };
  }

  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body || typeof body !== "object") {
    return { error: fail("invalid_body", ERROR_CODES.invalid_body, undefined, 400) };
  }

  if (typeof body.inbox === "string") {
    const found = findInboxFile(user, body.inbox);
    if (!found) {
      return { error: fail("unknown_inbox_file", ERROR_CODES.unknown_inbox_file, undefined, 404) };
    }
    return { text: fs.readFileSync(found.file, "utf8"), filename: found.entry.filename, body };
  }

  // A small export pasted straight in. No extension on purpose — detection
  // has to read the contents rather than guess from a name (see the v1
  // route's own note on why "inline.jsonl" was the wrong default).
  if (typeof body.text === "string") return { text: body.text, filename: "inline", body };

  return { error: fail("no_file", ERROR_CODES.no_file, undefined, 400) };
}

export async function POST(request: Request, { params }: RouteContext<"/api/v2/[user]/import">) {
  const { user } = await params;
  const auth = await requireJournalOwner(request, user);
  if (!auth.ok) return auth.response;
  // Auth before existence, same order as the journal document route (B1615)
  // — an anonymous caller must not be able to tell a missing journal from a
  // missing token.
  if (!getUser(user)) return fail("unknown_user", ERROR_CODES.unknown_user, undefined, 404);

  const dryRun = readDryRun(request);
  if (dryRun === null) {
    return fail("invalid_request", `${ERROR_CODES.invalid_request} dryRun must be true, false, or absent.`, undefined, 400);
  }

  // Before the body is touched, like the media route.
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > REQUEST_MAX_BYTES) {
    return fail(
      "body_too_large",
      `${ERROR_CODES.body_too_large} A years-long export is bigger than that — put it in the ` +
        "inbox in pieces, or split it by month and import each one; the store merges and " +
        "thins across calls.",
      undefined,
      413,
    );
  }

  const source = await bytesFrom(request, user);
  if ("error" in source) return source.error;
  const { text, filename, body } = source;

  const kind = typeof body.kind === "string" ? body.kind : undefined;
  if (kind === undefined || !(IMPORT_KINDS as readonly string[]).includes(kind)) {
    return fail(
      "unknown_kind",
      (kind === undefined ? "Say what kind of data this is. " : `No such kind ${JSON.stringify(kind)}. `) +
        `Known kinds: ${IMPORT_KINDS.join(", ")}. A kind is what the data *is*; the format is ` +
        `who wrote it. GET /api/v2/${user}/import lists both.`,
      undefined,
      400,
    );
  }
  const chosenKind = kind as ImportKind;

  if (!dryRun) {
    const refusal = await storageRefusal(user, Buffer.byteLength(text));
    if (refusal) return fail("storage_full", refusal, undefined, 400);
  }

  const format = typeof body.format === "string" ? body.format : undefined;

  if (chosenKind === "contacts") {
    // A vCard is read and reported, never written by itself — dryRun
    // changes nothing here, for the same reason it changes nothing for a
    // bank statement's own read-only report.
    const address = readContactsFile(text, filename, { format });
    if ("refusal" in address) {
      return fail(
        address.refusal === "unknown_format" ? "unreadable" : address.refusal,
        address.message,
        address.problems,
        400,
      );
    }
    return ok({
      ...address,
      next:
        "Nothing has been written and nobody has been mailed. Agree which of these are " +
        "actually contacts of this journal — never choose for somebody else — then send " +
        `the agreed rows to POST /api/v2/${user}/contacts/import. Each becomes a pending ` +
        "row with its own confirmation mail; none of them is postcard-addressable until " +
        "it confirms.",
    });
  }

  let result: ReturnType<typeof importGps>;
  if (dryRun) {
    result = importGps(user, text, filename, { format, dryRun });
  } else {
    const guard = await withStorageQuota(user, Buffer.byteLength(text), () =>
      importGps(user, text, filename, { format, dryRun }),
    );
    if (!guard.ok) return fail("storage_full", guard.problem, undefined, 400);
    result = guard.value;
  }

  if (isRefusal(result)) {
    return fail(
      result.refusal === "unknown_format" ? "unreadable" : result.refusal,
      result.message,
      result.problems,
      400,
    );
  }

  return ok({
    ...result,
    kind: chosenKind,
    dryRun,
    next: dryRun
      ? "Nothing was written. Send the same call without ?dryRun to keep it."
      : `Now \`POST /api/v2/${user}/trips/<trip>/track\` for each trip whose map should show ` +
        "where you actually went. Nothing is drawn until you do — and the export is still " +
        `in the inbox: \`DELETE /api/v2/${user}/media\` with \`{"src": "inbox:<id>"}\` when ` +
        "you are done with it, because it is the unthinned original of your whole location " +
        "history.",
  });
}
