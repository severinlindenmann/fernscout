// The shared write path every v2 PATCH/PUT sits on — B1608, phase 2 step 3.
//
// Pure, like ./incomplete.ts: no fs, no "server-only", no next import. A
// route hands this the stored document (already read from disk) and the raw
// parsed JSON body, and gets back a body safe to hand to `schema.parse()`,
// or a refusal — the two rules the golden contract says must happen ONCE,
// here, rather than per route:
//
//   - V2 — echo-tolerant server-owned/immutable fields (`stripEchoedFields`)
//   - T6 — decline retraction (`retractDeclines`)
//
// Plus T5: one writable-fields list per resource, shared by /api/web and
// /api/v2, so the two doors cannot drift about what a caller may set.
//
// Plus two conditional checks that need something a Zod schema cannot see —
// the journal's own config, or the trip's own media — and so belong at the
// door rather than in ./schemas/ (00-decisions.md): `checkTranslations`
// (B1625) and `checkCover` (B1626, the immediately-buildable half).
import { ERROR_CODES } from "../errorCodes";
import type { MissingRow, ProblemRow } from "./incomplete";

/** A field this resource never actually lets a caller change, described by
 * where it lives in the document and what to say if somebody tries. */
export type Immutable = {
  /** Dotted path into the document — `["baseCurrency"]`, `["owner","email"]`,
   * or `["username"]` for a field that is not even in the write schema. */
  path: readonly string[];
  /** What to answer when the value sent back differs from what is stored. */
  refusal: string;
  /**
   * Whether a byte-identical echo should be REMOVED from the body before
   * `schema.parse()`, rather than merely left in place. Only a field the
   * write schema does not declare at all needs this (`username` on a
   * journal): left in, it is refused as an unrecognised key by
   * `z.strictObject` regardless of matching. A field the schema DOES
   * declare (`baseCurrency`, `owner.email`) needs no such removal — it is
   * already a valid value for a field the schema expects, and deleting it
   * from a REQUIRED parent object (`owner`) would only manufacture a new
   * "missing" error the caller never caused. Defaults to `false`.
   */
  remove?: boolean;
};

function getPath(obj: unknown, path: readonly string[]): unknown {
  let cur = obj;
  for (const key of path) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

function deletePath(obj: Record<string, unknown>, path: readonly string[]): void {
  if (path.length === 0) return;
  if (path.length === 1) {
    delete obj[path[0]];
    return;
  }
  const child = obj[path[0]];
  if (child !== null && typeof child === "object") {
    deletePath(child as Record<string, unknown>, path.slice(1));
  }
}

/** No library dependency for this — the values on either side of the
 * comparison are always plain JSON (numbers, strings, booleans, arrays,
 * plain objects), never a `Date` or anything else `JSON.parse` cannot
 * produce, so a hand-written structural walk is the whole job. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  const ak = Object.keys(a as object);
  const bk = Object.keys(b as object);
  if (ak.length !== bk.length) return false;
  return ak.every(
    (k) => Object.hasOwn(b as object, k) && deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}

export type EchoStripResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; field: string; message: string };

/**
 * V2 — echo-tolerant server-owned/immutable fields.
 *
 * A field a caller may never actually move — one the write schema does not
 * even declare (a journal's `username`), or one the domain layer refuses to
 * change once set (`baseCurrency`, `owner.email` — R3 in
 * `06-contract-deltas.md`) — is refused UNLESS the value sent back is
 * byte-identical to what is already stored, in which case it is silently
 * dropped before the body ever reaches `schema.parse()`.
 *
 * This has to run BEFORE the parse, not after: every v2 write body is a
 * `z.strictObject`, which refuses an unrecognised key on sight. A caller
 * that GETs a document, changes one field and sends the whole thing back —
 * the obvious thing to do — would have its echoed `username` refused before
 * this function ever got a chance to notice it matched what is on file.
 *
 * `stored` is `null` on a create (a `PUT` with a client-chosen id and
 * nothing behind it yet): there is no prior value an echo could match, so
 * every listed field is left exactly as sent for the schema to judge on its
 * own — the immutability these fields describe is about *changing* a value
 * that already exists, not about what a brand new document may state.
 */
export function stripEchoedFields(
  body: Record<string, unknown>,
  stored: Record<string, unknown> | null,
  fields: readonly Immutable[],
): EchoStripResult {
  const next: Record<string, unknown> = structuredClone(body);
  for (const field of fields) {
    if (!stored) continue;
    const attempted = getPath(next, field.path);
    if (attempted === undefined) continue;
    const current = getPath(stored, field.path);
    if (deepEqual(attempted, current)) {
      if (field.remove) deletePath(next, field.path);
    } else {
      return { ok: false, field: field.path.join("."), message: field.refusal };
    }
  }
  return { ok: true, body: next };
}

/**
 * T6 — decline retraction, in the one place every write path shares it.
 *
 * `checkPatchConflicts` (schemas/shared.ts) is stateless — it only ever sees
 * one call, so it can catch a patch that both supplies AND declines a
 * section in the same body, but it cannot see that the section was declined
 * in some EARLIER call. This is the other half: a write that supplies a
 * field named in the document's STORED `declined` map clears that entry,
 * because the section is no longer silently absent — it has been answered —
 * and the reason recorded for the old decline no longer describes the
 * document.
 *
 * Returns the stored map unchanged (same reference) when nothing was
 * retracted, so a caller can tell "nothing to do" from "here is a new map"
 * without a deep-equality check of its own.
 */
export function retractDeclines(
  incoming: Record<string, unknown>,
  storedDeclined: Record<string, string> | undefined,
  declinableFields: readonly string[],
): Record<string, string> | undefined {
  if (!storedDeclined) return storedDeclined;
  let changed = false;
  const next = { ...storedDeclined };
  for (const field of declinableFields) {
    if (incoming[field] !== undefined && next[field] !== undefined) {
      delete next[field];
      changed = true;
    }
  }
  return changed ? next : storedDeclined;
}

/**
 * B1616 — a decline answered by a DIFFERENT field, not by a field of the
 * same name.
 *
 * T6 above only clears a stored decline when the incoming document supplies
 * a field CALLED that. `buddies` never is one: a solo trip declines it at
 * create (`tripCreate`'s own bespoke check in `trip.ts`, not
 * `checkRequiredOrDeclined`, because there is no `buddies` field to be
 * required-or-declined about), and the fact that answers it is
 * `people.length > 1` on `people`, a field that already exists for its own
 * reason. Supplying `people` is not "supplying `buddies`", so T6 could never
 * see it — a solo trip's `declined.buddies` was permanent: any later PATCH
 * that grew the party kept the stale decline, and `tripCreate`'s own
 * superRefine then refused the merged document as claiming buddies both ways
 * (listed in `people` AND declined).
 *
 * The schema is right to refuse that combination — a decline that no longer
 * describes the document is exactly what T6 exists to prevent everywhere
 * else. What was missing is this doing the same job for the one decline key
 * that is not itself a field. Written as a map, not an `if` in the route,
 * because `buddies` is very unlikely to be the last decline key with this
 * shape — the next one is a row here, not a second special case.
 */
const DECLINE_ANSWERED_BY: Readonly<Record<string, (doc: Record<string, unknown>) => boolean>> = {
  buddies: (doc) => Array.isArray(doc.people) && doc.people.length > 1,
};

/**
 * Applies `DECLINE_ANSWERED_BY` to a document about to be validated —
 * mutates `doc.declined` in place (dropping the key entirely once it is
 * empty), the same "operate on the document you are about to hand the
 * schema" style the route already uses for `days`/`cover` above it.
 *
 * `patch` is the raw body THIS call sent — needed so a caller who explicitly
 * re-declines `buddies` in the very call that also grows `people` past one
 * is still refused for the contradiction, rather than having it silently
 * cleaned up out from under them: only a decline that merely SURVIVED from
 * the stored document is retracted, never one the caller just asked for.
 * Safe to call unconditionally: a document with no matching decline, or no
 * `declined` at all, is left untouched.
 */
export function retractAnsweredDeclines(doc: Record<string, unknown>, patch: Record<string, unknown>): void {
  const declined = doc.declined as Record<string, string> | undefined;
  if (!declined) return;
  const patchDeclined = (patch.declined as Record<string, string> | undefined) ?? {};
  let changed = false;
  const next = { ...declined };
  for (const [key, answered] of Object.entries(DECLINE_ANSWERED_BY)) {
    if (next[key] !== undefined && patchDeclined[key] === undefined && answered(doc)) {
      delete next[key];
      changed = true;
    }
  }
  if (!changed) return;
  if (Object.keys(next).length > 0) doc.declined = next;
  else delete doc.declined;
}

/**
 * B1616 — the other dead end. v1's dedicated `.../visibility` route dropped
 * a stale `listed` (or `teaser`) whenever narrowing/widening crossed the
 * public/closed line; v2 folded that route into the trip document and
 * nothing took the job over. `listed` is required-or-declined on a public
 * trip and refused outright on a closed one; `teaser` is the mirror. Both
 * are ordinary fields, so once one is stored it survives an unrelated PATCH
 * merge untouched — a public trip's stored `listed` is still there after
 * `PATCH {visibility: "private"}`, and `tripCreate`'s revalidation of the
 * merged document then refuses it as "a closed trip is never advertised,
 * remove listed", forever, because a caller cannot un-send a key by omitting
 * it under merge-patch semantics.
 *
 * The schema's refusal is correct — the two questions really are mutually
 * exclusive. This is the route doing the merge properly, per
 * `00-decisions.md`: a conditional rule that needs the stored document
 * (what visibility USED to be, so the route knows which question just
 * stopped applying) belongs at the door, not in the schema, which only ever
 * sees one document and cannot tell an old value from a new one.
 *
 * Drops only the question that stopped existing — `listed` (and any
 * `declined.listed`) on narrowing to `private`/`guest`, `teaser` on widening
 * to `public`. The question that now DOES apply (`teaser` on narrowing,
 * `listed` on widening) is deliberately left for `tripCreate`'s own
 * required-or-declined refusal to ask for, exactly as it already does at
 * create — this function does not invent an answer for a question the
 * caller has not answered.
 *
 * `patch` is the raw body THIS call sent, for the same reason
 * `retractAnsweredDeclines` above takes one: a caller who explicitly sends
 * `listed` (or `declined.listed`) on an already-closed trip is asking for a
 * refusal, not a cleanup, and `test/trip-visibility-api.test.ts`'s
 * "listed: true is refused on a trip whose visibility does not advertise
 * it" depends on that surviving. Only a value that merely CARRIED OVER from
 * the stored document — the caller never touched it this call — is dropped.
 */
export function reconcileVisibility(doc: Record<string, unknown>, patch: Record<string, unknown>): void {
  if (doc.visibility === "public") {
    if (patch.teaser === undefined) delete doc.teaser;
  } else if (doc.visibility === "private" || doc.visibility === "guest") {
    if (patch.listed === undefined) delete doc.listed;
    const patchDeclined = (patch.declined as Record<string, string> | undefined) ?? {};
    if (patchDeclined.listed === undefined) {
      const declined = doc.declined as Record<string, string> | undefined;
      if (declined && declined.listed !== undefined) {
        const { listed: _listed, ...rest } = declined;
        if (Object.keys(rest).length > 0) doc.declined = rest;
        else delete doc.declined;
      }
    }
  }
}

/**
 * T5 — one writable-fields list per resource, shared by the `/api/web`
 * cookie door and the `/api/v2` bearer door (a later ticket builds the
 * former; this is the one place both will read from). The journal's own
 * list is smaller than `journalWrite`'s full shape by exactly one thing —
 * `declined` is not a field a caller "writes" in the sense this list
 * describes (what may be *asked for*), it is the answer to being asked, so
 * it is listed alongside the sections it can decline rather than as an
 * eleventh writable field of its own.
 */
export const JOURNAL_WRITABLE_FIELDS = [
  "title",
  "owner",
  "locales",
  "baseCurrency",
  "displayCurrencies",
  "units",
  "visibility",
  "tagline",
  "figures",
] as const;

/**
 * The journal's echo-tolerant fields — R3 in `06-contract-deltas.md` is
 * `baseCurrency`; `owner.email` is the same shape of rule
 * (`JOURNAL_FIELD_REFUSALS.owner` in `lib/journals.ts`, carried over
 * unchanged from v1: that address decides who can get a token for this
 * journal, so a token must never be able to move it); `username` is not in
 * the write schema at all, so an echoed one has nowhere else to be caught.
 */
export const JOURNAL_IMMUTABLE_FIELDS: readonly Immutable[] = [
  {
    path: ["baseCurrency"],
    refusal:
      "baseCurrency is not writable after a journal exists. A cost written without a currency IS " +
      "a cost in the base currency, so changing it would not reconvert the money — it would " +
      "silently change what every amount already recorded means. Send it back exactly as GET " +
      "returned it, or leave it out of the patch.",
  },
  {
    path: ["owner", "email"],
    refusal:
      "owner.email is not writable. It is the address that decides who can get a token for this " +
      "journal, so a token can never move it. Send it back exactly as GET returned it, or leave " +
      "owner out of the patch.",
  },
  {
    path: ["username"],
    refusal: "username is derived from the journal's own folder name and is never written.",
    // Not a field `journalPatch`/`journalWrite` declare at all — an echoed
    // match has to be REMOVED, or `z.strictObject` refuses it as unrecognised
    // regardless of matching. See the `remove` field's own comment.
    remove: true,
  },
];

/**
 * A trip's echo-tolerant fields — B1612 (phase 2 step 3, parcel B). `id` is a
 * genuine `tripCreate`/`tripPatch` field (unlike a journal's `username`), so
 * an echo needs no `remove` — the schema already accepts it, and this only
 * refuses a caller trying to rename the trip out from under its own folder.
 *
 * `status` and `track` need `remove: true` for the same reason a day's own
 * `status` does (see `DAY_IMMUTABLE_FIELDS` below): `tripDoc` adds both on
 * every read, and `tripBase` — the `z.strictObject` `tripCreate`/`tripPatch`
 * are built from — declares neither, so a caller that GETs a trip and PUTs
 * or PATCHes the whole thing back would be refused for two keys it never
 * chose to send, on every echo, always. Both are server-derived (`status`
 * from the dates, `track` from the gps store) and never writable regardless
 * of value, so there is nothing to compare an echo against — either field
 * present is simply dropped before the schema ever sees it.
 */
export const TRIP_IMMUTABLE_FIELDS: readonly Immutable[] = [
  {
    path: ["id"],
    refusal:
      "id is not writable after a trip exists. It is the trip's folder name and the URL segment " +
      "that addresses it. Send it back exactly as GET returned it, or leave it out of the patch.",
  },
  {
    path: ["status"],
    refusal: "status is not writable. It is derived from the trip's dates on every read.",
    remove: true,
  },
  {
    path: ["track"],
    refusal: "track is not writable. It is derived from the gps store, which no route can write to.",
    remove: true,
  },
];

/**
 * A day's echo-tolerant fields — same ticket. `status` is NOT here despite
 * being server-influenced too: unlike a trip's `id` or `track`, a day's
 * `status` has exactly one value the write schema can represent
 * (`z.literal("draft")`), and that value is also the one `DAY_DECLINABLES`
 * requires present-or-declined at CREATE — so a generic byte-identical-echo
 * removal would strip `status: "draft"` off every ordinary PUT replace of a
 * still-draft day (the obvious GET → edit one field → PUT the whole thing
 * back) and turn it into a 422 for a field the schema never stopped wanting.
 * `resolveStatusEcho` (./days.ts) is the value-aware version this needs
 * instead: "draft" always reaches the schema untouched, and only "published"
 * — the one value the literal can never accept at all — is dropped when it
 * merely echoes what's already stored.
 */
export const DAY_IMMUTABLE_FIELDS: readonly Immutable[] = [
  {
    path: ["slug"],
    refusal:
      "slug is not writable after a day exists. It is the day's filename and the URL segment that " +
      "addresses it. Send it back exactly as GET returned it, or leave it out of the patch.",
  },
];

/** What `checkTranslations` answers — the two remaining gaps split by kind
 * (B1619), on top of B1625's original refusal:
 *
 *   - `invalid` — the caller sent something wrong: a locale the journal does
 *     not declare, or the day's own written language duplicated under
 *     `translations` (it is already IN the day's own title/content; a second
 *     copy under its own key is two answers to one question with no way to
 *     tell which wins). A `problems` row, same shape `invalid_translations`
 *     already used.
 *   - `incomplete` — the caller has not finished answering: the journal
 *     declares a language `translations` does not cover. A 422 `missing`
 *     entry, the same asked-or-declined shape every other open section uses
 *     — a silent gap here is a reader getting no page rather than a wrong
 *     one, which is worse.
 *
 * The specific language names live in these detail rows, built per request
 * from the journal's own locales — NOT in `DAY_DECLINABLES`' static
 * `whyRequired` (00-decisions.md: that string is part of the schema, and a
 * per-journal fact does not belong there).
 */
export type TranslationsCheck =
  | { kind: "invalid"; message: string; problems: ProblemRow[] }
  | { kind: "incomplete"; missing: MissingRow[] };

/**
 * B1625/B1619 — a translation naming a locale the journal does not declare,
 * the day's own language duplicated under `translations`, or a translations
 * map that covers only some of what the journal is owed.
 *
 * `schemas/trip.ts` and `schemas/day.ts` both carry the same comment on their
 * own `translations` field: the route refuses a locale the journal does not
 * declare, since it would be written and never rendered. A Zod schema cannot
 * make any of these checks — it never sees the journal's config — so they
 * live here, called from both the trip and the day write paths, on create
 * and on patch alike (T5's shape: one shared function so the two resources
 * and the two doors cannot drift about what "declared" and "owed" mean).
 *
 * Names every offending or missing locale at once, not the first —
 * `problemsFrom`'s own convention (./incomplete.ts): a caller fixes every bad
 * key, or answers every open language, in one round trip rather than being
 * told about them one at a time.
 *
 * `writtenLocale` is the journal's own `defaultLocale` — the language a
 * day's or trip's own title/content/tagline/intro is already written in, and
 * so the one language `translations` must never repeat a key for. Owed
 * languages (every OTHER locale the journal declares) are only checked once
 * every key given is confirmed valid — a `translations` map with a bad key
 * in it is reported as that, not additionally as missing the language it
 * should have used instead.
 *
 * `translations` is read as `unknown` because it arrives before or after
 * `schema.parse()` depending on the caller's own shape — a non-object value
 * is not this function's problem (the schema's own shape check already
 * refuses it) and is silently passed as "nothing to check" rather than
 * duplicating that refusal here. Likewise: `translations` entirely absent is
 * schema territory too — `DAY_DECLINABLES`/`TRIP_DECLINABLES` already require
 * it present-or-declined, so a genuinely single-language journal (`owed` is
 * empty) never reaches the incomplete check below at all.
 */
export function checkTranslations(
  translations: unknown,
  locales: readonly string[],
  writtenLocale: string,
): TranslationsCheck | null {
  if (translations === undefined || translations === null) return null;
  if (typeof translations !== "object" || Array.isArray(translations)) return null;

  const keys = Object.keys(translations);
  const bad = keys.filter((code) => !locales.includes(code));
  const duplicated = keys.filter((code) => code === writtenLocale);

  if (bad.length > 0 || duplicated.length > 0) {
    return {
      kind: "invalid",
      message: ERROR_CODES.invalid_translations,
      problems: [
        ...bad.map((code) => ({
          field: `translations.${code}`,
          problem: `"${code}" is not a locale this journal declares (${locales.join(", ") || "none"}).`,
        })),
        ...duplicated.map((code) => ({
          field: `translations.${code}`,
          problem:
            `"${code}" is this journal's own written language — the day's (or trip's) own title ` +
            `and content already hold it. A second copy under translations.${code} is the same ` +
            `thing said twice with no way to tell which one wins; delete it, or move it here if ` +
            `it actually holds different words.`,
        })),
      ],
    };
  }

  const owed = locales.filter((code) => code !== writtenLocale && !keys.includes(code));
  if (owed.length === 0) return null;

  return {
    kind: "incomplete",
    missing: owed.map((code) => ({
      field: `translations.${code}`,
      why_required: `this journal is read in ${locales.join(", ")}, so this carries "${code}" too, or the whole translations section declines`,
      to_decline: "declined.translations: <reason>",
    })),
  };
}

/**
 * B1626 (the immediately-buildable half) — `cover` must name a `src` this
 * trip's own gallery already carries. No Zod schema can check this either —
 * it needs the trip's own stored media, not just the shape of one string —
 * so it lives here, called from the trip write path with the set of `src`
 * values `tripDays()` (lib/api/v2/trips.ts) actually has.
 *
 * `cover` is a plain optional string with no floor on length, so an absent
 * value and an empty string are different questions: this function is not
 * where "clear the cover back to absent" gets decided (that is the rest of
 * B1626 — a contract change needing the owner's agreement, not a build
 * decision — and is deliberately left alone). `""` is left un-judged for the
 * same reason `invalid_cover`'s own error text already names it as the way
 * to clear: refusing it here would be this ticket quietly deciding the
 * question it says it is not deciding.
 */
export function checkCover(cover: string | undefined, mediaSrcs: ReadonlySet<string>): string | null {
  if (cover === undefined || cover === "") return null;
  if (mediaSrcs.has(cover)) return null;
  return `${ERROR_CODES.invalid_cover} Got "${cover}".`;
}
