// GET/PATCH/DELETE the journal document — B1608, phase 2 step 3.
//
// schema.parse -> shared domain function -> full stored-document echo, the
// golden contract's own line for every route. DELETE is the one untouchable
// safety shape: it removes nothing, answers 202, and the second step happens
// in a mailbox — see lib/deletions.ts.
import type { ZodType } from "zod";
import { journalDoc, journalPatch, journalWrite, JOURNAL_DECLINABLES, ownerEmailPending, type JournalDoc } from "@/lib/api/v2/schemas";
import { problemsFrom, splitIssues } from "@/lib/api/v2/incomplete";
import { etagFor, fail, ifMatchStale, ok, readDryRun, readJson } from "@/lib/api/v2/route";
import { JOURNAL_IMMUTABLE_FIELDS, clearDeclinedSections, retractDeclines, stripEchoedFields } from "@/lib/api/v2/write";
import { mayActAsOwner, ownerOnlyRefusal, outOfScopeRefusal, ownsUser, resolveBearer } from "@/lib/api/v2/auth";
import { ERROR_CODES } from "@/lib/api/errorCodes";
import { journalV2Fields, setJournalV2Fields, type JournalV2Fields } from "@/lib/journals";
import { DELETION_TTL_MINUTES, humanBytes, requestDeletion } from "@/lib/deletions";
import { journalTombstone } from "@/lib/tombstones";
import { getUser } from "@/lib/users";
import { CODE_TTL_MINUTES, isEmail } from "@/lib/auth";
import { issueOwnerEmailCode } from "@/lib/ownerEmailChange";
import { isEnabled } from "@/lib/capabilities";
import { fromAcceptLanguage, pickLocale } from "@/lib/contacts/locale";
import { translateIn } from "@/lib/locales";
import { sendTransactional } from "@/lib/mail";
import { renderMail } from "@/lib/mail/template";
import { rateLimitFor } from "@/lib/rateLimit";
import { serverSite } from "@/lib/site";

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
  // Authenticate BEFORE resolving the journal — B1615. The other order lets
  // an anonymous caller tell `404 no_such_journal` from `401 missing_token`
  // and so enumerate usernames, which v1 never allowed and which `guest`
  // journals exist specifically to prevent.
  const bearer = await resolveBearer(request);
  if (!bearer.ok) return bearer.response;
  const stored = currentDoc(user);
  if (!stored) return fail("no_such_journal", ERROR_CODES.no_such_journal, undefined, 404);
  if (!ownsUser(bearer.session, user)) return outOfScopeRefusal(bearer.session, user);
  // Owner-only, like PATCH and DELETE below — B1652. `ownsUser` answers only
  // "which journal is this token for", and a **trip-scoped** token answers
  // yes: it is a token for this journal, held by somebody on one trip's
  // `people:` list. Without the second check that token could read the whole
  // journal document, `owner.email` included. Being on the bus is not the
  // same as holding the journal's own details, which is the line
  // `mayActAsOwner` exists to draw. A trip-scoped agent that needs to know
  // about the journal has `GET /api/v2/{user}/status`.
  if (!mayActAsOwner(bearer.session, user)) return ownerOnlyRefusal();

  return ok(stored, { etag: etagFor(stored) });
}

export async function PATCH(request: Request, { params }: RouteContext<"/api/v2/[user]">) {
  const { user } = await params;
  // Authenticate BEFORE resolving the journal — B1615. The other order lets
  // an anonymous caller tell `404 no_such_journal` from `401 missing_token`
  // and so enumerate usernames, which v1 never allowed and which `guest`
  // journals exist specifically to prevent.
  const bearer = await resolveBearer(request);
  if (!bearer.ok) return bearer.response;
  const stored = currentDoc(user);
  if (!stored) return fail("no_such_journal", ERROR_CODES.no_such_journal, undefined, 404);
  if (!ownsUser(bearer.session, user)) return outOfScopeRefusal(bearer.session, user);
  if (!mayActAsOwner(bearer.session, user)) return ownerOnlyRefusal();

  return applyJournalPatch(user, stored, request);
}

/**
 * How a patch is checked against the rest of the document — the journal's
 * own copy of `TripPatchMode` (`.../trips/[trip]/route.ts`, B2011).
 *
 * `whole` is the API's contract, unchanged: a stored journal must be
 * complete — `tagline`/`figures` required-or-declined — before any write
 * lands, so an agent is told about an open section the first time it
 * touches the journal.
 *
 * `sections` is the studio's: an owner-cookie door narrowed to one part of
 * the journal (B2022's `.../figures/set`) must not be refused just because
 * a DIFFERENT section — a journal signed up before v2 with no tagline and
 * no decline, say — is still open. The section the patch sends is still
 * validated by its own schema (`journalPatch`, `base.partial()`); only the
 * demand that everything else already be answered is dropped.
 */
export type JournalPatchMode = "whole" | "sections";

/**
 * The write itself, factored out of `PATCH` above so `/api/web/[user]`
 * (the owner's cookie proxy, B1595) can reach the same validation and the
 * same writer without a bearer token ever existing — no token is minted for
 * the browser to hold, and this function is called directly, in-process,
 * never over HTTP. Everything above this point in `PATCH` is the bearer
 * check; everything below never looked at `session` in the first place.
 */
export async function applyJournalPatch(
  user: string,
  stored: JournalDoc,
  request: Request,
  mode: JournalPatchMode = "whole",
): Promise<Response> {
  const currentEtag = etagFor(stored);
  if (ifMatchStale(request, currentEtag)) {
    return fail("stale_document", ERROR_CODES.stale_document, stored, 409);
  }

  const body = await readJson(request);
  if (!body.ok) return body.response;
  if (typeof body.value !== "object" || body.value === null || Array.isArray(body.value)) {
    return fail("invalid_request", `${ERROR_CODES.invalid_request} The body must be a JSON object.`, undefined, 400);
  }

  // B1733 — a CHANGED owner.email starts a verification instead of taking
  // the immutable-field refusal below. Ahead of `stripEchoedFields` on
  // purpose: that function cannot tell "refuse this" from "prove this
  // first", it only knows byte-identical-or-refused, and `owner.email`
  // needs the second answer now. An UNCHANGED echo (the ordinary
  // GET/edit/PATCH-the-whole-thing round trip) is deliberately left for
  // `stripEchoedFields` to drop below — starting a verification on every
  // mirrored save would make the mirror unusable, and there is nothing to
  // prove about a value the caller already had. Only a syntactically valid,
  // DIFFERENT address takes this door; anything else (a malformed string, a
  // byte-identical echo) falls through to the ordinary path.
  const rawOwner = (body.value as Record<string, unknown>).owner;
  if (rawOwner && typeof rawOwner === "object" && !Array.isArray(rawOwner) && "email" in (rawOwner as Record<string, unknown>)) {
    const requested = (rawOwner as Record<string, unknown>).email;
    if (typeof requested === "string" && isEmail(requested) && requested !== stored.owner.email) {
      return startOwnerEmailVerification(user, stored, requested, request);
    }
  }

  // V2 — echo-tolerant server-owned/immutable fields, BEFORE the schema ever
  // sees the body: `username`, `baseCurrency` and `owner.email` sent back
  // unchanged (the obvious result of GET, edit one field, PATCH the whole
  // thing) are silently dropped here; sent back CHANGED, they are refused
  // with a reason rather than by `journalPatch`'s strict-object check, which
  // could only ever say "unrecognised field" about `username` and nothing
  // at all about the other two, since both are genuine schema fields. A
  // CHANGED, syntactically valid `owner.email` never reaches this refusal —
  // see above — so what lands here is either unchanged, or changed to
  // something that was never going to be a real address anyway.
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

  // B1631 — T6's mirror: a section this patch DECLINES loses its stored
  // value in the same call, so the merged document is never asked to hold
  // both at once.
  clearDeclinedSections(merged, patch.declined as Record<string, string> | undefined);

  // `journalPatch` is `base.partial()`: every field present is checked by
  // its own schema, and — unlike `journalWrite` — nothing asks for the
  // required-or-declined fields that are absent, the same narrowing
  // `tripPatch`/`"sections"` already gives a trip's own studio doors.
  const finalParsed = mode === "sections" ? journalPatch.safeParse(merged) : journalWrite.safeParse(merged);
  if (!finalParsed.success) {
    const shape = journalDoc.shape as unknown as Record<string, ZodType>;
    const { incomplete, problems } = splitIssues(finalParsed.error, shape, DECLINABLE_FIELDS);
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

  // In `sections` mode the parse was partial, so the type is looser than
  // `JournalV2Fields`'s; the values are the stored document's own plus
  // whatever validated sections the patch sent, same reasoning `tripFields
  // as TripFile` gives beside `applyTripPatch`'s own `"sections"` branch.
  const toWrite = finalParsed.data as JournalV2Fields;

  if (dryRun) {
    const preview = journalDoc.parse({ ...toWrite, username: user });
    return ok(preview, { etag: etagFor(preview) });
  }

  const written = setJournalV2Fields(user, toWrite);
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

const DAY = 24 * 60 * 60 * 1000;
const OWNER_EMAIL_PER_ADDRESS = { max: 5, windowMs: DAY };
const OWNER_EMAIL_PER_OWNER = { max: 5, windowMs: DAY };

/**
 * B1733 — step one of moving `owner.email`: prove the new address before
 * anything is written. Nothing here touches `config.json`; the only writer
 * is `.../owner/email/redeem`, on a correct code.
 */
async function startOwnerEmailVerification(
  user: string,
  stored: JournalDoc,
  newEmail: string,
  request: Request,
): Promise<Response> {
  // Before anything is issued (`lib/auth`'s own rule for a code, applied
  // here too) — a live code with no way to deliver it is worse than no code.
  if (!isEnabled("mail")) {
    return fail("mail_disabled", ERROR_CODES.mail_disabled, undefined, 503);
  }

  const perAddress = rateLimitFor("owner-email-change-address", newEmail.toLowerCase(), OWNER_EMAIL_PER_ADDRESS);
  if (!perAddress.ok) return ownerEmailTooMany(perAddress.retryAfter, "This address");
  const perOwner = rateLimitFor("owner-email-change-owner", user, OWNER_EMAIL_PER_OWNER);
  if (!perOwner.ok) return ownerEmailTooMany(perOwner.retryAfter, "This journal");

  const locale = pickLocale(stored.locales[0], fromAcceptLanguage(request.headers.get("accept-language")));
  const site = serverSite();
  const { id, code } = await issueOwnerEmailCode(user, newEmail);
  const vars = { site: site.name, title: stored.title, code, minutes: CODE_TTL_MINUTES };

  try {
    await sendTransactional(
      renderMail(
        newEmail,
        translateIn(locale, "mail.ownerEmailCodeSubject", vars),
        {
          preheader: translateIn(locale, "mail.identityCode", vars),
          title: translateIn(locale, "mail.ownerEmailCodeTitle"),
          blocks: [
            { kind: "paragraph", text: translateIn(locale, "mail.identityCode", vars) },
            { kind: "paragraph", text: translateIn(locale, "mail.ownerEmailCodeWhat", vars) },
            { kind: "paragraph", text: translateIn(locale, "mail.ownerEmailCodeIgnore") },
          ],
          footer: translateIn(locale, "mail.identityFooter", vars),
        },
        user,
      ),
      "an owner-email verification code the recipient just asked for",
    );
  } catch (err) {
    console.error(`[owner-email] verification code for ${user} could not be sent:`, err);
    return fail("mail_failed", ERROR_CODES.mail_failed, undefined, 503);
  }

  return ok(
    ownerEmailPending.parse({
      pending: "owner_email",
      id,
      next: `POST /api/v2/${user}/owner/email/redeem`,
    }),
    { status: 202 },
  );
}

function ownerEmailTooMany(retryAfter: number, who: string): Response {
  const minutes = Math.max(1, Math.ceil(retryAfter / 60));
  const response = fail(
    "too_many_requests",
    `${who} has asked for too many owner-email codes today. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
    { retryAfter },
    429,
  );
  response.headers.set("Retry-After", String(retryAfter));
  return response;
}
