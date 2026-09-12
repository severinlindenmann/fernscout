# Every change to the golden contract, and why

The schemas in `lib/api/v2/schemas/` were reviewed field by field with the
owner and frozen. **This file is the complete list of changes made to them
since**, with the reason for each. If a change to that folder is not on this
list, it is a mistake and should be reverted.

The rule, in the owner's words (2026-09-12): *the contract does not bend back.
Change the format, the code or the content to fulfil it. Only drift if there
is genuinely no easy way — and then stop and ask.*

Read this beside `git log --oneline -- lib/api/v2/schemas/`. Every commit
touching that folder must correspond to a row here.

---

## Changed

### D1 — `costItem` exported from `day.ts`
**What:** `const costItem` → `export const costItem`. No change to the shape.
**Why:** `trip.ts` needs it for D2. The alternative was a second copy of the
same four fields, which is a list that disagrees with itself within a month.
**Drift:** none. The wire is byte-identical before and after.

### D2 — `trip.costs` gains `items` and `note`
**What:** `costs: {budget, visibility?}` → `costs: {budget, items?, note?, visibility?}`,
where `items` is `costItem[]` and `note` is a string.
**Why:** `costs.md` on disk has always carried three things — a budget, a list
of **preparation** cost lines (flights, insurance, visas, a roof box), and a
prose body. The frozen section modelled only the budget. Its own comment said
*"Entries on days live on the days"*, which is true of day spend and is not
true of these: preparation costs are spent **before the trip has any days**,
so there is no day to hang them on and there was no field to send them in. A
caller could state a budget but not the spend that justified it, and
`content/example`'s two largest trips both carry such lines — the replay
could not have carried them.
**Authorised:** owner, 2026-09-12 — *"we can also define something right now"*.
**Ticket:** B1597.
**Drift:** this is a **widening**, not a bend-back. It adds an address for a
fact that had none; it does not restore a v1 spelling. `category:
"preparation"` was already in `COST_CATEGORIES`, so the vocabulary for these
lines existed before the field to put them in did.

### D4 — `nickname` on `journal.owner` (required) and on a trip's `person` (optional)
**What:** `owner: {name, email}` → `{name, nickname, email}` in `journal.ts`;
`person: {name, email}` → `{name, nickname?, email}` in `trip.ts`.
**Why:** it is not v1 drag — the **code requires it**. `lib/config.ts`'s
`UserConfig` has `owner.nickname: string` as a required field and refuses a
config without it (`lib/journals.ts:306` — *"A journal needs the owner's
nickname — what the site calls them. It is not guessed"*), and `lib/site.ts`
reaches for it before `name` when it renders the byline. A `journalWrite`
document without it could not be written to disk as a valid config, so the
contract would have been promising a write it cannot perform. On a trip's
`person` it is **optional**, matching `lib/trips.ts`, which already reads it
as optional, and `lib/tripPeople.ts`, which falls back to `name`.
**First rejected, then added:** the first instinct was to leave it out on the
grounds that "old content happens to carry it" is not a reason to widen a
reviewed contract. That was wrong about the facts — the field is live in the
render layer, not a v1 leftover.
**Authorised:** owner, 2026-09-12 — *"add back as needed if it is needed in
the codebase somewhere; if not leave it out"*. It is needed.
**Drift:** a widening, and the narrowest one that makes the document
writable.

### D5 — `JOURNAL_DECLINABLES` exported from `journal.ts`
**What:** `const JOURNAL_DECLINABLES` → `export const JOURNAL_DECLINABLES`. No
change to its contents or to any accepted document.
**Why:** phase 2 step 3 (B1608) builds the shared write path
(`lib/api/v2/write.ts`) that owns T6 decline retraction — a write supplying a
field named in the document's *stored* `declined` map clears that entry, which
a stateless schema check cannot do because it only ever sees one call. That
function needs the list of field names a journal's `declined` map may hold
(`tagline`, `figures`), and a second, hand-typed `["tagline", "figures"]`
beside this one is the same list-in-two-places failure D1 already fixed for
`costItem` — the day and trip schemas already export their own
(`DAY_DECLINABLES`, `TRIP_DECLINABLES`); this was the one left private.
**Drift:** none. The wire is byte-identical before and after.

### D3 — the solo-trip buddies issue moves from `path: ["people"]` to `path: ["buddies"]`
**What:** the `ctx.addIssue` path in `tripCreate`'s superRefine. No change to
any field, message or accepted document.
**Why:** the 422 body keys each row by `issue.path[0]`, so the row came back
as `{field: "people", to_decline: "declined.buddies: …"}`. A caller building
`declined.<field>` from the row — which works for every other row — sends
`declined.people`, which is not a decline key at all, and gets a fresh
unrelated refusal instead of resolving the point. `to_provide` was wrong too:
it showed the `people` array's schema, which says nothing about answering the
buddies question.
**Drift:** none. This is the 422 body telling the truth about itself; the set
of accepted documents is unchanged.

---

## Considered and REJECTED — the contract stands

These are real problems found in real content. Each has an obvious fix that
loosens the schema, and each was rejected in favour of changing the content.
Recorded so nobody re-opens them believing they are undiscovered.

### R1 — a day's `translations` requires both `title` and `content`
**Found:** nine of forty-four days in `content/example` carry a German or
Hungarian `content:` with no `title:` — the prose translated, the title left
in the original. `dayWrite` refuses them.
**The tempting fix:** make both fields optional, as v1 has them.
**Why it was rejected:** an absent title and a title that is deliberately
identical are **different claims**, and only one of them is recoverable a
year later. A day whose title reads the same in German says so by carrying
that same string in the German block — `title: "Utah Red Country"` under `de`
is the true statement *"in German this day is called Utah Red Country"*.
Nothing is invented by writing it down, and the v1 shape's silence is exactly
what v2 exists to refuse.
**What happens instead:** the nine days get a complete `translations` block in
the phase-3 replay. `test/api-v2-schemas.test.ts` carries a test asserting the
refusal so the reasoning survives.
**Ticket:** B1601.

### R3 — `journalPatch` permits `baseCurrency`, the domain layer forbids changing it
**Found:** `journalPatch = journalWrite.partial()`, so `baseCurrency` is
patchable on the wire, while `lib/journals.ts`'s
`JOURNAL_FIELD_REFUSALS.baseCurrency` refuses ever changing it after creation
— correctly, since every stored figure is denominated in it.
**The tempting fix:** remove `baseCurrency` from the patch shape (narrowing
the contract), or let the route hand-refuse it silently (the contract
promising what it will not deliver — which `AGENTS.md` calls the worse of the
two failures).
**Why neither is needed:** V2's echo-tolerance already answers this. A patch
carrying `baseCurrency` **byte-identical to the stored value** is an echo and
is accepted; a patch carrying a *different* value is refused. That is the
general rule for server-owned and immutable fields, applied once in the shared
write path, not a special case for this field.
**Drift:** none. No schema change.

---

## Not a contract change, recorded because it looks like one

- `lib/api/errorCodes.ts` became `as const satisfies Record<string, string>`
  rather than annotated. The annotation widened `keyof typeof ERROR_CODES` to
  `string`, so `fail("invalid_reqest", …)` compiled and answered with a word
  no document defines. Keys only; no code added or removed.
- `incomplete` and `stale_document` are answered by v2's plumbing and are
  **not yet** in `ERROR_CODES`, because `test/openapi-contract.test.ts` fails
  on a code no route answers. `V2_ONLY_CODES` in `lib/api/v2/route.ts` is the
  IOU, and the step that ships the first route answering them adds them and
  empties the list. A test asserts the invariant in both directions.
- The **on-disk file format** is not the contract. It changed wholesale (a
  day's frontmatter is now `dayDoc` minus the filename and the body) under the
  owner's decision of 2026-09-12 that breaking changes to storage are allowed
  because only `content/example` needs converting. `docs/v2-migration/05-status.md`
  carries the before/after table.
- **Storage moved from markdown to JSON, same day, on a second owner
  decision (2026-09-12) that overruled decision 4 in `00-decisions.md`**
  ("storage stays markdown; JSON is wire-only"). `entries/YYYY-MM-DD-
  slug.md` became `entries/YYYY-MM-DD-slug.json`; `trip.md` + `costs.md` +
  `plan.md` collapsed into **one** `trip.json`, since the only reason they
  were three files was a real prose body each and JSON has no
  prose-vs-frontmatter split to preserve that argument — `costs` and `plan`
  were already sections of one wire document, and are now sections of one
  file too. Days stay one file each; they are separate documents with their
  own slugs and their own route. **No schema changed** — `dayWrite`,
  `tripCreate` and every other schema under `lib/api/v2/schemas/` are
  untouched; only the serializer (`lib/api/v2/markdown.ts` →
  `lib/api/v2/documents.ts`, `dayToJson`/`dayFromJson`/`tripToJson`/
  `tripFromJson`) and the file layout changed.
