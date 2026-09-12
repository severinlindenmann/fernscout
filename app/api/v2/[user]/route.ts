// GET/PATCH/DELETE the journal document — B1608, phase 2 step 3.
//
// schema.parse -> shared domain function -> full stored-document echo, the
// golden contract's own line for every route. DELETE is the one untouchable
// safety shape: it removes nothing, answers 202, and the second step happens
// in a mailbox — see lib/deletions.ts.
import type { ZodType } from "zod";
import { journalDoc, journalPatch, journalWrite, JOURNAL_DECLINABLES } from "@/lib/api/v2/schemas";
import { problemsFrom, splitIssues } from "@/lib/api/v2/incomplete";
import { etagFor, fail, ifMatchStale, ok, readDryRun, readJson } from "@/lib/api/v2/route";
import { JOURNAL_IMMUTABLE_FIELDS, retractDeclines, stripEchoedFields } from "@/lib/api/v2/write";
import { mayActAsOwner, ownerOnlyRefusal, outOfScopeRefusal, ownsUser, resolveBearer } from "@/lib/api/v2/auth";
import { ERROR_CODES } from "@/lib/api/errorCodes";
import { journalV2Fields, setJournalV2Fields } from "@/lib/journals";
import { DELETION_TTL_MINUTES, humanBytes, requestDeletion } from "@/lib/deletions";
import { journalTombstone } from "@/lib/tombstones";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

const DECLINABLE_FIELDS = JOURNAL_DECLINABLES.map((d) => d.field);

/** The stored document, as `journalDoc` — never thrown, since this file only
 * ever builds it from a `UserConfig` it already knows is on disk. */
function currentDoc(user: string) {
  const journal = getUser(user);
  if (!journal) return null;
  return journalDoc.parse({ ...journalV2Fields(journal), username: user });
}

export async function GET(request: Request, { params }: RouteContext<"/api/v2/[user]">) {
  const { user } = await params;
  const stored = currentDoc(user);
  if (!stored) return fail("no_such_journal", ERROR_CODES.no_such_journal, undefined, 404);

  const bearer = await resolveBearer(request);
  if (!bearer.ok) return bearer.response;
  if (!ownsUser(bearer.session, user)) return outOfScopeRefusal(bearer.session, user);

  return ok(stored, { etag: etagFor(stored) });
}

export async function PATCH(request: Request, { params }: RouteContext<"/api/v2/[user]">) {
  const { user } = await params;
  const stored = currentDoc(user);
  if (!stored) return fail("no_such_journal", ERROR_CODES.no_such_journal, undefined, 404);

  const bearer = await resolveBearer(request);
  if (!bearer.ok) return bearer.response;
  if (!ownsUser(bearer.session, user)) return outOfScopeRefusal(bearer.session, user);
  if (!mayActAsOwner(bearer.session, user)) return ownerOnlyRefusal();

  const currentEtag = etagFor(stored);
  if (ifMatchStale(request, currentEtag)) {
    return fail("stale_document", ERROR_CODES.stale_document, stored, 409);
  }

  const body = await readJson(request);
  if (!body.ok) return body.response;
  if (typeof body.value !== "object" || body.value === null || Array.isArray(body.value)) {
    return fail("invalid_request", `${ERROR_CODES.invalid_request} The body must be a JSON object.`, undefined, 400);
  }

  // V2 — echo-tolerant server-owned/immutable fields, BEFORE the schema ever
  // sees the body: `username`, `baseCurrency` and `owner.email` sent back
  // unchanged (the obvious result of GET, edit one field, PATCH the whole
  // thing) are silently dropped here; sent back CHANGED, they are refused
  // with a reason rather than by `journalPatch`'s strict-object check, which
  // could only ever say "unrecognised field" about `username` and nothing
  // at all about the other two, since both are genuine schema fields.
  const stripped = stripEchoedFields(
    body.value as Record<string, unknown>,
    stored as unknown as Record<string, unknown>,
    JOURNAL_IMMUTABLE_FIELDS,
  );
  if (!stripped.ok) {
    return fail("invalid_request", stripped.message, undefined, 400);
  }

  const patchParsed = journalPatch.safeParse(stripped.body);
  if (!patchParsed.success) {
    return fail("invalid_request", ERROR_CODES.invalid_request, problemsFrom(patchParsed.error), 400);
  }
  const patch = patchParsed.data as Record<string, unknown>;

  // The patch only ever answers the questions IT raises (decisions.md). The
  // full asked-or-declined check happens once, below, against the MERGED
  // document — which is also what lets a journal migrated from before v2
  // (no `declined` map at all) answer 422 `incomplete` the first time
  // somebody tries to change anything about it, rather than silently
  // accepting a document that was never actually complete.
  const storedWritable: Record<string, unknown> = { ...(stored as Record<string, unknown>) };
  delete storedWritable.username;

  // T6 — decline retraction, once, here: supplying a field the STORED
  // document had declined clears that stored decline. A patch that ALSO
  // declines the same field in this call is a contradiction the merged
  // `journalWrite` parse below catches on its own (`checkRequiredOrDeclined`
  // refuses "both provided and declined").
  const retracted = retractDeclines(
    patch,
    storedWritable.declined as Record<string, string> | undefined,
    DECLINABLE_FIELDS,
  );
  const declinedMerged: Record<string, string> = {
    ...(retracted ?? {}),
    ...((patch.declined as Record<string, string> | undefined) ?? {}),
  };

  const merged: Record<string, unknown> = { ...storedWritable, ...patch };
  if (Object.keys(declinedMerged).length > 0) merged.declined = declinedMerged;
  else delete merged.declined;

  const finalParsed = journalWrite.safeParse(merged);
  if (!finalParsed.success) {
    const shape = journalDoc.shape as unknown as Record<string, ZodType>;
    const { incomplete, problems } = splitIssues(finalParsed.error, shape);
    if (incomplete) return fail("incomplete", ERROR_CODES.incomplete, incomplete, 422);
    return fail("invalid_request", ERROR_CODES.invalid_request, problems, 400);
  }

  const dryRun = readDryRun(request);
  if (dryRun === null) {
    return fail(
      "invalid_request",
      `${ERROR_CODES.invalid_request} dryRun must be true, false, or absent.`,
      undefined,
      400,
    );
  }

  if (dryRun) {
    const preview = journalDoc.parse({ ...finalParsed.data, username: user });
    return ok(preview, { etag: etagFor(preview) });
  }

  const written = setJournalV2Fields(user, finalParsed.data);
  if (!written.ok) {
    return fail("invalid_request", written.message, undefined, 400);
  }
  const echo = journalDoc.parse({ ...written.journal, username: user });
  return ok(echo, { etag: etagFor(echo) });
}

/**
 * Ask to delete a journal — this call deletes nothing. It answers `202` and
 * mails the address in `config.json` a single-use link; only the button on
 * that page ends anything. Reporting a `202` here as "deleted" is false —
 * say a mail is waiting, and stop.
 */
export async function DELETE(request: Request, { params }: RouteContext<"/api/v2/[user]">) {
  const { user } = await params;

  // Answered before the token is looked at: deleting a journal revokes every
  // session it had, so a retry of this same call would otherwise read
  // "invalid token" — true, and useless — rather than "this is gone".
  const stone = journalTombstone(user);
  if (stone && !getUser(user)) {
    return fail(
      "gone",
      `"${user}" was deleted on ${stone.deletedAt.slice(0, 10)}. There is nothing left to delete.`,
      undefined,
      410,
    );
  }

  const bearer = await resolveBearer(request);
  if (!bearer.ok) return bearer.response;
  if (!ownsUser(bearer.session, user)) return outOfScopeRefusal(bearer.session, user);
  if (!mayActAsOwner(bearer.session, user)) return ownerOnlyRefusal();

  const asked = await requestDeletion({ kind: "journal", username: user }, { sessionId: bearer.session.id });
  if (!asked.ok) {
    // `deletion_unavailable` (mail switched off) is the one refusal from
    // `requestDeletion` that has no v2 code of its own — it is the same
    // fact `mail_disabled` already names, so it borrows that wording rather
    // than adding a code this route would be the only one ever to answer.
    const code = asked.error === "deletion_unavailable" ? "mail_disabled" : asked.error;
    return fail(code as Parameters<typeof fail>[0], asked.message, undefined, asked.status);
  }

  const { summary } = asked;
  return ok(
    {
      ok: true,
      deleted: false,
      status: "confirmation_sent",
      mailedTo: asked.email,
      expires: asked.expiresAt,
      willDelete: {
        journal: summary.title,
        trips: summary.trips,
        days: summary.days,
        files: summary.files,
        size: humanBytes(summary.bytes),
      },
      note:
        "NOTHING HAS BEEN DELETED. A mail has gone to the address that owns this journal " +
        `(${asked.email}) with a link to a page that asks once more and has a button on it. ` +
        `The link works for ${DELETION_TTL_MINUTES} minutes and once only. You cannot follow it ` +
        "yourself and you should not try — this step exists so that a person, not an agent, ends " +
        "a journal.",
      next:
        `Tell the person you were talking to that a mail is waiting at ${asked.email}, and that ` +
        "the journal is still there until they open it and press the button. Do not report this " +
        "as deleted.",
    },
    { status: 202 },
  );
}
