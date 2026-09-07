// The closed vocabulary `content-model.json` is written in.
//
// See `docs/plans/W41-the-file-shape-is-published.md` for why it is exactly
// these eight `assert` kinds and nothing that can be executed: the document
// is fetched from wherever `FERNSCOUT_URL` points and used to inspect a
// private journal on somebody's laptop, so an interpreter for it must never
// be able to produce wrong *behaviour* — only wrong *findings*, which are at
// least visible.
//
// Nothing in this file runs a rule. The interpreter that does, for the sole
// purpose of proving `content-model.json` agrees with `lib/validate/*`, is
// `lib/contentModel/interpret.ts` — and it is test-only. A real client (the
// helper in `fernscout-helper`, or the one this server ships for itself,
// B609) writes its own interpreter against the published JSON; nothing here
// is exported to it.

/** The five kinds of value this vocabulary can name. No `integer`, no
 * `null` — nothing in a `trip.md`, a `config.json` or a day needs either, and
 * adding a kind nothing uses is exactly the kind of drift this document
 * exists to end. */
export type PrimitiveType = "string" | "number" | "boolean" | "array" | "object";

/**
 * One of the eight closed kinds — see the table in W41. Anything that does
 * not fit becomes a `NamedCheck` instead of a ninth kind.
 */
type Assert =
  | { assert: "type"; type: PrimitiveType }
  | { assert: "enum"; values: readonly (string | number | boolean)[] }
  /**
   * `pattern` is the one kind that takes something regex-shaped, so it is the
   * one kind a hostile or broken instance could turn into a hang. It is
   * therefore always anchored (`^…$`) and length-capped — see
   * `MAX_PATTERN_LENGTH` in `document.ts` — and a real interpreter is
   * expected to match it with a linear-time matcher or not at all. Carried as
   * a string, not a `RegExp`: this crosses into JSON on the way to a
   * stranger's document.
   */
  | { assert: "pattern"; pattern: string; expected?: string }
  | { assert: "required" }
  /**
   * This object's named members have these types. Only ever addressed
   * through a `path` ending in the one wildcard this vocabulary has —
   * `features.*`, reaching every member of that map — so `members` names one
   * flat level of member name to type and does not nest a further `shape`
   * inside itself.
   */
  | { assert: "shape"; members: Record<string, PrimitiveType> }
  /** No key here that is not declared. `keys` is the closed list for this
   * `path` — for a whole file that is every key it may carry. */
  | { assert: "known-key"; keys: readonly string[] }
  /** The API takes this key; a file carrying it is describing a call. */
  | { assert: "never-in-file" }
  /** A file may carry this key; it is never sent over the API. */
  | { assert: "never-over-api" };

/** The five files this version of the document describes. */
export type FileName =
  | "config.json"
  | "trip.md"
  | "entries/YYYY-MM-DD-slug.md"
  | "costs.md"
  | "plan.md";

/**
 * One rule. `where` names the file, `path` addresses a key inside it —
 * `""` is the file's own root object (what a whole-file `known-key` rule
 * needs), `"budget.total"` a nested one, and `"features.*"` the wildcard.
 */
export type Rule = Assert & {
  where: FileName;
  path: string;
  /** Why this holds, in prose — for a person reading the document by hand,
   * and for an agent that hits the rule and wants more than "refused". */
  because?: string;
};

/**
 * A cross-field or otherwise inexpressible check, declared but not encoded —
 * W41's "Everything else is a named check". The client implements it by
 * `id`; this document's job is only to say **that it exists**, so a client
 * that has not implemented one can say so rather than silently skipping it.
 */
type NamedCheck = {
  kind: "named";
  id: string;
  because: string;
  /** Which files it concerns, for a reader — not load-bearing for a client. */
  where?: readonly FileName[];
};

type FileDescription = {
  what: string;
  api: string;
  optional?: boolean;
  /**
   * Keys in this file that a client must never offer as a tip, however
   * absent or unset they are — B620. `test` is the one example today:
   * `model.mjs` marked it `noTip: true` because a settable-looking key
   * named `test` reads, to a person on a real holiday, as "you could mark
   * this day as one that did not happen" — a choice nobody should be
   * offered about a trip they took.
   *
   * This lives here, on the file's own entry, rather than as a ninth
   * `assert` kind: it is not a check run against a value — it never fires,
   * never refuses, never reports a problem — it is a fact about a *key*,
   * the same shape as the `what`/`api` prose beside it. A suppression is
   * not an assertion, and W41 closes the assertion vocabulary at eight;
   * this does not reopen it.
   */
  noTip?: readonly string[];
};

export type ContentModelDocument = {
  /** A client that does not understand this major version refuses to
   * validate against the document and says so — it does not guess, and it
   * does not fall back silently. */
  contentModel: 1;
  files: Record<FileName, FileDescription>;
  rules: Rule[];
  named: NamedCheck[];
};
