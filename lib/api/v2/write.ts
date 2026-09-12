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
