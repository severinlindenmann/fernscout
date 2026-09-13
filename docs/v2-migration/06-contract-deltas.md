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

### D6 — `daySlug` exported from `day.ts`
**What:** the slug regex, previously inline in `dayBase`, becomes an exported
const the schema itself uses. No change to the pattern.
**Why:** the day route validates a URL's slug segment, and a second regex
beside the first is a regex that drifts. A slug is also a **filename**, so
this is a security boundary as much as a shape check — the two must be the
same expression, not two copies of one.
**Drift:** none. The accepted set is identical.

### D7 — `daySummary` added to `day.ts`
**What:** a new `{slug, title, date, status, test?}` object schema.
**Why:** `GET .../trips/{trip}?days=summaries` is V12, already in the
decisions; the projection was promised and had no shape. This gives it one
rather than letting each route invent a row.
**Authorised:** decided before the parcel was built, as the answer to "what
does `?days=summaries` return" — which the step-3 reconnaissance had flagged
as undefined and therefore un-buildable.
**Drift:** additive, and it describes a **read** projection only. No write
shape changes.

### D8 — `publishRequest` and `sendRequest` (new file `schemas/publish.ts`)
**What:** two small request schemas — `{declineTracked?, sendMail?,
sendWhatsapp?}` and `{channels: ("mail"|"whatsapp")[]}`.
**Why:** these are decisions *about a publish*, not fields of a day, so they
are side-schemas rather than additions to `dayDoc`. They replace
`readPublishFlags`'s hand-rolled `=== true` checks (`lib/api/publishFlags.ts`,
retired). `sendRequest` is S1: one send door with `channels[]`, where v1 had
`send-mail` and `send-whatsapp` as separate routes.
**Drift:** none to any reviewed schema — new files for routes that had no
schema at all.

### D9 — `DECLINABLE_KEYS` exported from `trip.ts`
**What:** `const` becomes `export const`. No change to the list.
**Why:** T6's decline retraction, in the shared write path, must be able to
clear a stored decline of `listed` or `buddies`. Both are declinable — the
`declined` map accepts them — but neither is in `TRIP_DECLINABLES`, because
each is asked by a bespoke `superRefine` rather than by
`checkRequiredOrDeclined`. Without the full list, retracting those two would
silently not work.
**Drift:** none. The wire is byte-identical.

### D10 — `DAY_DECLINABLE_KEYS` exported, and `declineTracked` becomes an enum
**What:** the const becomes exported, and `publishRequest.declineTracked`
changes from `z.array(z.string())` to `z.array(z.enum(DAY_DECLINABLE_KEYS))`.
**Why:** a **correctness bug**, found by the typechecker rather than by a
test. As free strings, `declineTracked: ["nonsense"]` was accepted and written
straight into the day's `declined` map as a key nothing reads — a decline that
looks recorded, satisfies nothing, and answers no question anybody asked. The
publish route then indexed a typed record with an arbitrary string, which is
what surfaced it.
**Drift:** a **narrowing** of a schema written in this same step (D8), not of
a reviewed one. It refuses input that was never meaningful.

### D11 — `schemas/auth.ts` (new file)
**What:** request/response shapes for the credential doors under `/api/auth`
— `codesRequest`, `codesRedeemRequest`, `linksRedeemRequest` and their
responses (B1600, phase 2 step 2).
**Why:** these replace six v1 routes
(`/api/auth/{request,verify,link,identity/request,identity/verify,
identity/link,signup/request,signup/verify}` → `/api/auth/codes`,
`/api/auth/codes/redeem`, `/api/auth/links/redeem`) and needed their own wire
shapes. `00-decisions.md`'s field-level list covers day/trip/journal/figures/
media/status; auth's own request bodies were never part of that review round,
so this is new schema for new routes, the same shape as D8.
**Drift:** none to any reviewed schema — a new file for routes that had no
schema at all.

### D12 — `schemas/geocode.ts` (new file)
**What:** `geocodeRequest`/`geocodeResponse` for `POST /api/v2/geocode`
(B1608, phase 2 step 3).
**Why:** mirrors v1's `/api/v1/geocode` body and response. Like D11, this is
new schema for a route the golden-contract review round never named, not a
change to a reviewed one — added here for the same reason D8 and D11 are:
this file is easier to trust as the complete list of `schemas/` files than as
a list with an unstated exception for "the ones that are net-new". The file's
own header comment previously argued a net-new schema needs no row here; that
argument is sound about WHY there is no drift, but this ledger records rows
for net-new surfaces anyway (see D8, D11), so the comment has been corrected
rather than left to disagree with this file.
**Drift:** none to any reviewed schema — a new file for a route that had no
schema at all.

### D13 — `journalStatus.drafts` widened to `{trip, slug, title, test?}`
**What:** `drafts: z.array(z.strictObject({trip, slug}))` →
`drafts: z.array(z.strictObject({trip, slug, title, test?}))`.
**Why:** an agent reading the review queue (`GET /api/v2/{user}/status`) has
to say WHICH day is waiting without a GET per row, and whether it is content
nobody lived before offering to publish it. `listDrafts` (`lib/api/entries.ts`)
already resolves both `title` and `test` (the latter inheriting from the
trip, B116's fix) — the v2 schema was narrower than the domain read it is
built on, for no reason tied to anything reviewed.
**Authorised:** `00-decisions.md`'s own field-level list already names the
wider shape — "credits, drafts+title+test, trips, storage, inbox, token
scope" — so this is not a new decision, only the code catching up to Q14's
answer ("widen: yes") on a comment (`lib/api/v2/status.ts`) that had
mistakenly called the narrow shape "frozen".
**Drift:** none. This restores what was already decided; the narrow shape
that shipped was the drift.

### D14 — `null` on a PATCH clears `cover`, `accent`, `tagline` or `intro` back to absent
**What:** `.nullable()` added to these four fields, on the **patch shape
only** (`tripPatch` in `schemas/trip.ts`). `tripCreate`, `tripDoc`, and every
other field, are untouched. Sending `null` for one of the four removes the
key from the stored document, returning it to the state before that field
was ever set — the same effective result as never having answered it.
**Why:** B1626 found the gap twice on the same shape: `cover: ""` was
accepted as an ordinary string (stored verbatim, so `trip.cover ??
pickCover(days)` never fell through to the auto-pick — `??` only treats
`null`/`undefined` as absent), and an already-set `accent` could not be
declined, because a patch supplying only `declined.accent` merges over a
stored `accent` that survives untouched, and the merged document then has
the field both present and declined at once. Both are the same missing
convention: v2's merge-patch had **no spelling at all** for "remove this
field" — omitting a key means "unchanged", which is what makes a patch a
patch, but it left the opposite unsayable. The contract already names **RFC
7386 JSON Merge Patch** as its patch semantics, and in RFC 7386 `null` means
*remove the member*. This finishes the convention already cited rather than
adding one. `""` was rejected as the spelling for the same reason R1
rejected an absent translation title: an empty value and an absent value are
different claims.
**Where it acts:** once, in the shared write path (`lib/api/v2/write.ts`'s
new `applyNullClears`), on the MERGED document a PATCH is about to
revalidate — not in the schema (only `tripPatch` ever sees `null`) and not
on the raw incoming patch (which still needs its `null` intact for
`retractDeclines`/`checkPatchConflicts` to read as "this field is being
answered," not silently omitted, before it is deleted for good). This is the
one shared write path the doors sit on (T5), so a later `/api/web` cookie
door inherits the behaviour rather than reimplementing it.
**`accent` and `checkPatchConflicts`:** pairing `accent: null` with
`declined.accent` in the same call — the only way to swap a chosen accent
for a declined one — was itself refused before this ticket, because
`checkPatchConflicts` (`schemas/shared.ts`) read *any* non-`undefined` value,
`null` included, as "brought," and a field both brought and declined in one
patch is exactly the contradiction that function exists to catch. Fixed by
excluding `null` from "brought" there — not by touching
`DECLINE_ANSWERED_BY` (`write.ts`), which is B1616's mechanism for a decline
answered by a *different* field (`buddies`/`people`) and has nothing to say
about a field clearing itself. T6's own `retractDeclines` needed no change:
it already treats a field's presence in the incoming body — `null` included
— as "this question has been answered," so a stray `declined.accent` left
over from before the value was ever set is retracted the same way a real
value retracts it.
**Deliberately NOT in scope:**
- **Declinable sections** (`costs`, `plan`, `rates`, `figures`, `media`,
  `translations`, …) keep the `declined` map as their only "not answered"
  spelling. `{"costs": null}` is refused — not by new code, but because
  `costs` was never marked `.nullable()`, so Zod's own type check refuses it
  before any write-path logic runs. A second spelling for one thing is
  exactly the drift this row exists to avoid.
- **Derived and conditional fields** (`listed`, `teaser`, `buddies`,
  `status`, `track`) keep B1616's reconciliation
  (`reconcileVisibility`, `DECLINE_ANSWERED_BY`) and gain no `null`
  spelling. `{"listed": null}` is refused the same mechanical way as
  `costs`.
- **`PUT`.** A full replace already expresses absence by omission (decision
  7). `tripCreate` — the schema a PUT validates against — never gained
  `.nullable()` on any field, so `null` there is an ordinary type error.
**Authorised:** the owner, 2026-09-12 — the widening described in B1626's
own Work section, decided rather than built unilaterally because a merge-
patch convention is a contract question.
**Drift:** a **widening of the patch shape only**. No write shape changes
beyond it (create/replace still refuse `null` on every field), no read shape
changes (a GET never returns `null` for these four — the key is either
present or absent), and nothing that validated before this row stops
validating now.

### D15 — `schemas/money.ts` (new file)
**What:** a new schema module — `purchaseCreate`, `purchaseDoc`,
`PURCHASE_STATUSES`, `ledgerRow`, `LEDGER_REASONS` — exported from
`schemas/index.ts` alongside the rest.
**Why:** not a change to a frozen schema. The golden-contract review
(`01-golden-contract.md`) covered day/trip/journal/figures/media/status;
money (`docs/plans/2026-09-12-api-v2/money.md` §2.2-2.3, B1622 phase 2 step
4) never had a Zod module before this ticket, so there is nothing here that
bends back — this is the area's first schema, not its second.
**Drift:** none to record against a prior shape. Two fields are hand-kept
rather than imported from their source of truth (`PURCHASE_STATUSES`
mirrors `PaymentStatus` in `lib/payments.ts`; `LEDGER_REASONS` mirrors the
private `LedgerReason` union in `lib/credits.ts`) because both source
modules are `server-only` and a schema file may not pull a runtime array out
of one — the same constraint every other schema file already respects by
importing enums from *plain* modules only (`lib/costFormat.ts`,
`lib/validate/entry.ts`). Keep these two lists matching their source unions
by hand; there is no third copy to disagree with either of them.

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

## B1624 — print, inbox, statements, journals (phase 2 step 4)

New schemas under `lib/api/v2/schemas/`, exported from `index.ts`:

- `postcard.ts` — `postcardOrderWrite`/`postcardOrderDoc`/`postcardSource`.
  Backs `PUT/GET /api/v2/{user}/postcards/orders/{id}`. No `declined` map
  (print.md §2.1's own reasoning: every field is genuinely required or a
  plain optional with a sensible default, rule 2's carve-out).
- `statement.ts` — `statementRead`/`costsApplyRequest`. Backs
  `GET /api/v2/{user}/statements/{src}` and
  `POST /api/v2/{user}/trips/{trip}/costs/apply`. `statementRead` drops v1's
  `format`/`detected`/`skipped` fields — content.md §3's field table names
  only `src, trip?, dateRange, merchants, payments, rates`, and this is a
  read report, not an echo of a write.
- `inbox.ts` — `inboxList`. Backs `GET /api/v2/{user}/inbox`.
- `journalCreate.ts` — `journalCreate`. Backs `POST /api/v2/journals`. Its
  own file rather than a variant of `journalWrite` (./journal.ts): `owner` is
  two flat fields here, not `journalWrite`'s nested object, and every field
  is checked in `superRefine` with v1-parity prose rather than zod's built-in
  `enum`/`length` messages — B263/B277/B839's finding was that a generic
  refusal here costs a real person a redone conversation, and the wording is
  carried over rather than dropped for being verbose.

**Drift from print.md's recommended figure, deliberately:** `reserved_username`
answers `403`, not v1's `400` — content.md §10 asked for 403 ("includes a
tombstoned name") and this build follows the newer document over v1's actual
behaviour. Every test that asserted the old `400` was updated with a comment
pointing here.

**Cut, not carried forward:** `GET .../statements/{src}` takes no `from`/`to`
query — content.md §3's field table names none, and the whole statement is
always returned; the trip's own date window is no longer a server-side filter
on this read (an agent sends only the rows it means to apply, and a date with
no day is reported back as `orphaned` rather than silently narrowed earlier).

**Reused, not duplicated:** `POST /api/v2/journals`'s success response still
carries `localesNote` (B855) from `SECOND_LANGUAGE_COMMITMENT` in
`lib/api/agentCopy.ts` — added to `LIB_API_ALLOWLIST` in
`test/api-v2-imports.test.ts` as a plain, dependency-free string constant
with no request/response shaping of its own, the same reasoning already
covers `lib/api/errorCodes.ts`.

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
