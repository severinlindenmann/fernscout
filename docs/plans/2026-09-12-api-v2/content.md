# v2 design — Content long tail

Everything the decided core (trip/day/journal/figures/media/status) does not
cover: publish/unpublish, drafts, the costs statement agree-flow, track
drawing, trip-files, geocode, figure presets/preview, markdown twins,
documentation generation, journal lifecycle, and inbox reading.

All routes below live under `/api/v2/{user}/...` (bearer) unless marked
`/api/web` (cookie-only browser internals, outside the published contract) or
`/api/auth`. Error envelope, `declined` mechanism and client-chosen ids are as
decided in `shared.ts`; this document does not repeat them.

---

## 1. Publish / unpublish — the deliberate second call

### Inventory (v1)

| Route | Verb | Does | Calls it |
|---|---|---|---|
| `/api/v1/{user}/trips/{trip}/days/{slug}/publish` | POST | Owner-only. Runs the day through the full `TRACK`/decline contract again, writes any declines the call carries, checks a credits pre-flight for WhatsApp, calls `publishDraft`, optionally sends a letter/WhatsApp, and returns a `notify` nudge when nobody was told. | agent, `/agent` helper |
| `/api/v1/{user}/trips/{trip}/days/{slug}/unpublish` | POST | Owner-only. Mirror of publish: `unpublishEntry`, no ceremony, no send. | agent (B905) |
| `/api/helper/{user}/day/publish`, `/day/unpublish` | POST | Cookie-only browser twins of the above, for the room UI. | `/agent` browser page |
| `/api/v1/{user}/trips/{trip}/days/{slug}/send-mail`, `/send-whatsapp` | POST | Send the already-published day on one channel, named in the `notify.channels` a publish response offers. | agent, on request |

### v2 design

**`POST /api/v2/{user}/trips/{trip}/days/{slug}/publish`** — bearer, owner only
(a trip-scoped token is refused with `out_of_scope`, same as v1: being on the
bus is not deciding what the journal says — AGENTS.md, untouchable per rule 9).

This call is unchanged in shape from v1's, because it *is* the untouchable
safety shape (rule 9) — draft-then-publish stays two calls, and there is
still no `status: "published"` write path (`dayWrite.status` accepts only the
literal `"draft"`, enforced in the decided `day.ts`). What v2 cleans up is the
request/response envelope, not the mechanism.

**Edit schema** (request body — everything here is a *decision about this
publish*, not part of the day document, so it is a small side-schema rather
than a field on `dayDoc`):

| Field | Type | Class | Notes |
|---|---|---|---|
| `declineTracked` | `string[]` | optional | Names of trip-tracked facts (`costs`, `coordinates`, …) this day genuinely has none of. Absent is fine — a day with everything already answered needs nothing here. Written into the day's own `declined` map before the completeness check runs, exactly as v1. |
| `sendMail` | `boolean` | optional | Absent = no letter. The overwhelming safety default (rule 2's plain-optional exception): publishing fifteen days must never default to fifteen letters. |
| `sendWhatsapp` | `boolean` | optional | Same shape and same default. |

**Read/response schema:**

| Field | Type | Notes |
|---|---|---|
| `slug`, `status: "published"`, `url` | — | as v1 |
| `note` | string | the human sentence — test-content, visibility and locale aware, exactly as v1's `publishNotice` |
| `mail`, `whatsapp` | object, present only if requested | send summary |
| `notify` | object, present only if nobody was told and a channel exists | `{channels: [{channel, url}], ask}` — the same "ask, in words" nudge |

Refusals: `unknown_trip` 404 · `unknown_day` 404 · `already_published` 409 ·
`out_of_scope` 403 (trip-scoped token) · `incomplete_day` 422 (with the
missing-facts list, same shape as the `incomplete` envelope's `details.missing`)
· `no_credits` 402 (WhatsApp pre-flight).

**`POST /api/v2/{user}/trips/{trip}/days/{slug}/unpublish`** — identical
shape, no request body, no sends. Refusals: `unknown_trip` 404 ·
`unknown_day` 404 · `already_draft` 409 · `out_of_scope` 403.

**`send-mail` / `send-whatsapp`** stay their own calls
(`POST /api/v2/{user}/trips/{trip}/days/{slug}/send-{mail,whatsapp}`, owner
only) — a day already on the site, told on one channel long after publish, is
a distinct decision from the publish moment and keeps its own refusal
(`no_credits`, `already_sent` if applicable). Not redesigned here beyond the
prefix change; the v1 shape is sound.

### Proposed cuts

- **`/api/helper/{user}/day/publish` and `/unpublish`** stay as thin cookie
  wrappers under `/api/web` calling the same internal function as the v2
  bearer route — not part of the agent contract, unchanged in spirit.
- Nothing else to cut here: this pair is exactly rule 9's untouchable shape.

### Migration ledger

- `app/api/v1/.../publish/route.ts`, `.../unpublish/route.ts` → rewritten
  under `/api/v2`, same logic, request body validated by a new
  `publishRequest` zod schema (not yet in `lib/api/v2/schemas/`) instead of
  `readPublishFlags`'s hand-rolled `=== true` check. `readPublishFlags` in
  `lib/api/publishFlags.ts` is retired — the schema does its job.
- `lib/api/entries.ts`'s `publishDraft`, `unpublishEntry`, `publishNotice`,
  `factsOfEntry` are reused unchanged.
- No data migration: a day's `status` is unchanged on disk.

---

## 2. Drafts listing

### Inventory (v1)

`GET /api/v1/{user}/drafts` — owner or trip-scoped (scoped to that trip).
Wraps `draftQueue()`, which already backs `GET /api/v1/{user}/status`'s own
drafts array. Adds a `publish` URL per draft, and a `test` flag when true.

### v2 design

**Cut. Confirmed subsumed by `GET /api/v2/{user}/status`'s `journalStatus.drafts`.**

The decided `status.ts` schema already carries
`drafts: {trip, slug}[]`. A standalone drafts endpoint added nothing v1's own
`status` route didn't already answer except the per-item `publish` URL and
`test` flag — both cheap to fold into the one array rather than keep a
second door that returns the identical query.

**Recommendation to the owner (open question, see §14):** widen
`journalStatus.drafts` items to `{trip, slug, title, test?}` — `title` so an
agent doesn't need a follow-up `GET` per draft just to tell the owner what's
waiting, `test` because it's a one-bit flag `draftQueue` already resolves
with inheritance and dropping it silently would be an agent occasionally
offering to publish content nobody lived. `publish` URL itself is not
carried — an agent that knows the trip+slug already knows the publish
route's shape (`POST /trips/{trip}/days/{slug}/publish`), and repeating a
derivable URL per row is exactly the kind of inert field rule 8 cuts.

### Migration ledger

- `app/api/v1/{user}/drafts/route.ts` deleted.
- `lib/api/status.ts`'s `draftQueue()` gains `title` and keeps `test` in its
  returned rows; `journalStatus` schema in `lib/api/v2/schemas/status.ts`
  gains those two fields (owner's call — see open questions).
- No data migration.

---

## 3. The costs statement agree-flow

### Inventory (v1)

| Route | Verb | Does |
|---|---|---|
| `/api/v1/{user}/import` with `kind: "costs"` | POST | Reads a bank export (inbox file, multipart, or inline `text`), parses it, and answers with the whole report: payments, merchants, suggested date range, rates. **Writes nothing.** Owner-only (journal-wide, not trip-scoped — B671's "the store belongs to the whole journal" reasoning does *not* actually apply to costs, which is read-only and per-call; still gated the same way as `gps` today). |
| `/api/v1/{user}/trips/{trip}/costs/import` | POST | Takes `{rows: [{date, label, amount, currency, category}]}` — rows a person has agreed — and writes them onto the days they happened on. Writable by anybody who may write the trip, trip-scoped tokens included. Adds, never replaces. |

### v2 design

The v1 shape is sound (two calls, two decisions — which rows, which
category — neither the server's) but its *first* call sits oddly outside
the single media door the core has already decided on: every other kind of
upload (`photo`, `gps_history`, `document`) goes through
`POST /api/v2/{user}/media` with `kind`, and `bank_export` is already one of
`MEDIA_KINDS` in the decided `media.ts`. Splitting "upload the statement" and
"read what it says" into one call today only works because parsing is cheap
and synchronous — but the media door's contract is "store bytes, answer with
an item", not "store and parse and hand back a report", so v2 needs a small
second resource: the **statement**, addressed by the `src` the media door
already answered with.

**`POST /api/v2/{user}/media`** with `intent.kind: "bank_export"` — as
decided. Stores the file, answers `{src, kind: "bank_export", trip?, bytes,
duplicateOf?}`. Nothing parsed yet.

**`GET /api/v2/{user}/statements/{src}`** — NEW. Owner only (journal-wide;
a trip-scoped token is refused the same as v1's `needsJournalScope`, because
even though this reads one file rather than the whole store, the export
itself usually spans more than the one trip a scoped token is confined to).
Parses the media item at `src` (which must be `kind: "bank_export"`) and
answers the report — payments, merchants (sorted biggest-first), suggested
rates, suggested date window. Idempotent and side-effect-free: calling it
twice reads the same file twice.

| Field (read only — this is a `GET`, no body) | Type | Notes |
|---|---|---|
| `src` | string | echoes the media item |
| `trip` | string, optional | the trip named at upload, if any |
| `dateRange` | `{from, to}` | isoDate, the statement's own coverage |
| `merchants` | `{name, total, currency, count, suggestedCategory?}[]` | one row per merchant, sorted by spend — `suggestedCategory` is a hint (from `COST_CATEGORIES`, `lib/costFormat.ts:COST_CATEGORIES`), never written anywhere until agreed |
| `payments` | `{date, label, amount, currency, merchant}[]` | every row |
| `rates` | `Record<string,number>` | any currency the statement paid in that the trip's own rates don't cover |

Refusals: `unknown_statement` 404 (no such `src`, or it isn't a `bank_export`)
· `out_of_scope` 403 (trip-scoped token) · `unreadable_statement` 400 (bytes
present but no importer recognised them).

**`POST /api/v2/{user}/trips/{trip}/costs/apply`** — the write half, renamed
from `.../costs/import` because "import" now means the media door's own verb
and this call does something different (it applies agreed rows, it does not
import anything). Writable by anybody who may write the trip.

| Field | Type | Class | Notes |
|---|---|---|---|
| `rows` | `{date, label, amount, currency, category}[]` | required | `category` from `COST_CATEGORIES` (`lib/costFormat.ts`) — required per row, since the whole point of this call is that a person chose it |
| `statement` | `string` (the `src`) | optional | which statement these rows came from, for the record — purely informational, not re-validated against the parsed report |

Response: `{trip, written: [{date, count, kept}], orphaned: [date], total,
message, next?}` — unchanged from v1's `applyCosts` result shape.

Refusals: `unknown_trip` 404 · `invalid_costs` 400 (with `problems`) ·
`out_of_scope` 403 (a caller who may not write the trip at all).

### Proposed cuts

- **Nothing cut** — the shape (report, then agreed rows) is the safety shape
  AGENTS.md names explicitly ("An agent that picked the categories itself
  would be deciding what happened") and is untouchable per rule 9.
- The one real change is routing the *upload* half through the shared media
  door instead of `/import`'s own multipart/inline/inbox trident, and
  splitting "stored" from "parsed" into two calls — argued above, but this is
  a genuine design choice and belongs in open questions (§14).

### Migration ledger

- `app/api/v1/{user}/import/route.ts`'s `kind: "costs"` branch splits: the
  upload half is deleted (subsumed by the media door), the parse half moves
  to a new `app/api/v2/{user}/statements/[src]/route.ts` built on
  `lib/statements/read.ts:readStatement` unchanged.
- `app/api/v1/{user}/trips/{trip}/costs/import/route.ts` → renamed route
  under v2's `.../costs/apply`, same `lib/statements/apply.ts:applyCosts`
  and `validateRows` underneath.
- No data migration — nothing about costs.md or a day's `costs:` block
  changes shape.

---

## 4. Track drawing

### Inventory (v1)

| Route | Verb | Does |
|---|---|---|
| `/api/v1/{user}/trips/{trip}/track` | POST | Owner only. Derives `track.json` from the gps store (`lib/gps/store.ts`, never itself readable by any route), clipped to the trip's dates with private zones cut. Answers with counts (`segments`, `points`, `zones`), never a coordinate. |
| `/api/v1/{user}/trips/{trip}/tracks` | GET/PATCH | What facts a trip's *days* are required to answer (`costs`, `coordinates`, `weather`, …) — `lib/tracks.ts:TRACKS`. Owner only for PATCH. |

Two unrelated things share the near-identical name in v1 (`track` singular =
the drawn line; `tracks` plural = the day-requirement toggles), which is
itself worth fixing regardless of anything else.

### v2 design

**`POST /api/v2/{user}/trips/{trip}/track`** — NEW NAME kept as-is (it is
the one part of this pair that is genuinely its own decision, per
AGENTS.md's "the separate decision that draws one trip's line"). Owner only,
trip-scoped token refused outright (deriving reads the whole store across
the trip's dates — not this trip's business alone). No request body.

Response, refusals: unchanged from v1 (`written`, `segments`, `points`,
`zones`, or the "nothing in the store for these dates" 200).

`GET`/read-back: the derived line's presence already lives on the decided
`tripDoc.track: {present, updatedAt}` — no separate read route needed; that
is the "one fact, one address" rule already applied by the core design.

**The `/tracks` (plural) route is cut — see below.**

### Proposed cuts

**Cut `.../tracks` (GET/PATCH — the day-requirement toggle) entirely.**

The decided `trip.ts` schema already says this in its own comment: *"v1's
`tracks:` — 'what this trip keeps track of' is now the same declined map as
everything else, one mechanism instead of two."* That is: in v1, a trip could
pre-authorise its days to skip a whole category of fact (turn `costs`
tracking off for the trip, and every day stops being asked); in v2 the
`declined` map already lets *each day* decline any field with a reason, and
`checkRequiredOrDeclined` is the one mechanism everywhere. A trip-level
pre-authorisation duplicates what a day can already say for itself, at the
cost of a second, trip-scoped vocabulary (`TRACKS`) that has to stay in step
with the day's own declinable list — exactly the "kept in two places"
problem AGENTS.md warns about generally.

What is lost, honestly: a trip that has decided up front "we are not
tracking costs this whole journey" currently gets that decision made once;
in v2 every day repeats `declined: {costs: "not tracked this trip"}`
individually. That is more typing per day and a real regression for a long
trip with many days, unless client tooling (the `/agent` helper, a
personal agent's own habits) remembers the trip's standing answer and fills
it in automatically — which is exactly the kind of thing a client *should*
do rather than the server enforcing it a second way. Flagged as an open
question (§14) rather than decided here, since it trades a real convenience
for one fewer mechanism.

### Migration ledger

- `app/api/v1/.../track/route.ts` → renamed under `/api/v2`, same
  `lib/gps/api.ts:deriveTripTrack` underneath.
- `app/api/v1/.../tracks/route.ts` deleted if the cut is taken.
  `lib/api/tripTracks.ts`, `lib/tracks.ts`'s `TRACKS`/`TRACK_ROWS` constants
  and the `tracks:` field in `trip.md`'s frontmatter parser (`lib/trips.ts`)
  would all be retired with it — a real chunk of code, not a rename.
- Data migration: existing `trip.md` files with a `tracks:` block keep
  parsing (nothing rewrites old content); a v2 write of the whole trip
  document simply never emits the key again. Days that relied on a trip-off
  toggle to skip declaring costs need to start declining explicitly the next
  time they're rewritten — no retroactive rewrite of existing content is
  needed since the requirement only bites at publish-time completeness
  checks going forward.

---

## 5. Trip-files (helper-only)

### Inventory (v1)

`GET /api/helper/{user}/trip-files?trip={id}` — cookie-only, owner-only,
outside `/api/v1` and outside the published contract. Returns one named
trip's already-attached photographs (`getAllMedia`, capped at 60 tiles,
newest 60 by upload) for the `/agent` web helper's "reuse this photo"
picker.

### v2 design

**Stays `/api/web/{user}/trips/{trip}/files`** — cookie-only, unchanged in
shape (`{title, files: [{id, name, src, detail}]}`). This is explicitly a
browser-internal read optimisation, not part of the bearer contract: an
agent asking the same question reads it straight off `GET
/api/v2/{user}/trips/{trip}` (`tripDoc.days[].media`), which already carries
every attached photograph's `src` and `url`. Duplicating that as a bearer
route would be a second, capped, unpaginated view of the same fact — the
exact thing rule 5 ("one fact, one address") argues against. The helper's
own 60-tile cap and "newest first" ordering are a UI convenience with no
place in the documented contract.

### Proposed cuts

None — correctly scoped already; only the prefix moves (`/api/helper` →
`/api/web`, per rule 13's four-prefix split).

### Migration ledger

- `app/api/helper/{user}/trip-files/route.ts` moves to
  `app/api/web/{user}/trips/{trip}/files/route.ts` (path param instead of
  query string, matching the rest of `/api/web`'s nesting). Same
  `lib/helper/server.ts:tripFilesForRoom` underneath.

---

## 6. Geocode

### Inventory (v1)

`POST /api/v1/geocode` — bearer, capability-gated (`addressLookup`),
rate-limited to 1/second per session. Turns a place name into a ranked
shortlist of candidate coordinates; never writes anything, never picks for
the caller.

### v2 design

**`POST /api/v2/geocode`** — unchanged in every particular. This route
already follows every v2 rule: it asks, it never invents, it returns a
shortlist for a person to choose from rather than guessing, and it is not
scoped to a journal (no `{user}` in the path — the decided core doesn't
have a comparable "no-journal" utility route today, so this is the one
precedent for a bare `/api/v2/<verb>` door; worth the owner noting for
consistency with any future non-journal-scoped utility).

**Edit schema** (request body):

| Field | Type | Class | Notes |
|---|---|---|---|
| `query` | string | required | `MIN_QUERY_LEN`–`MAX_QUERY_LEN` chars (`lib/addressLookup.ts`) |
| `countryHint` | string | optional | narrows the search |
| `regionHint` | string | optional | narrows the search |
| `contextCoordinates` | `{lat, lng}[]` | optional | nearby points (e.g. the trip's other days) to rank candidates by proximity |

**Read schema:** `{results: [...]}` — provider-shaped candidates, unchanged.

Refusals: `address_lookup_disabled` 404 (capability off) · `invalid_request`
400 (`problems[]`, same shape as today) · `too_many_requests` 429
(`Retry-After`) · `provider_unavailable` 502.

### Proposed cuts

None.

### Migration ledger

- `app/api/v1/geocode/route.ts` → `/api/v2/geocode`, same
  `lib/addressLookup.ts:geocodePlace` underneath. `checkAgainstContract`
  (the v1-era openapi cross-check) is replaced by validating against a new
  `geocodeRequest` zod schema, consistent with every other v2 route.

---

## 7. Figure presets and preview — and how they attach to `/figures`

### Inventory (v1)

| Route | Verb | Does |
|---|---|---|
| `/api/v1/{user}/travellers/presets` | GET | The whole vocabulary (skin/hair/eyes/hairStyle/outfit/build/age/accessories/cloth), what each field is *for*, and twelve named starting points resolved into plain attributes. Open to any journal reader. |
| `/api/v1/{user}/travellers/preview` | GET | `?figure={…}` or `?party=[…]` → an SVG, rendered by the same pure function the site uses. No storage, no auth beyond "journal exists". |
| `/api/v1/{user}/travellers` | GET | The journal's own default party (`config.json`'s `travellers:` block) — owner only to read (and, via `PATCH config`, to write). |
| `/api/v1/{user}/trips/{trip}/travellers` | GET/PATCH/DELETE | One trip's own party, overriding the journal default. |
| `/api/v1/{user}/trips/{trip}/travellers/from-photo` | POST | Guess a starting figure from an uploaded photograph (a separate, best-effort helper). |

### v2 design

The decided `figures.ts` already redesigns the *storage* half: figures move
from inline blocks (journal's `travellers:`, trip's `travellers:`) to a
journal-level **library** of named `figureDoc`s referenced by id, with
`journalFigures`/`tripFigures` picking `{mode: "off" | "set"/"journal" |
"custom", figures: [ids]}`. This section is only the two *vocabulary* doors
(`presets`, `preview`) that sit beside that library and are not themselves
storage.

**`GET /api/v2/{user}/travellers/presets`** — unchanged in every particular
from v1: it is pure vocabulary, no journal data, open to any reader. Kept at
this path rather than folded under `/figures` because it answers "what words
exist", not "what figures does this journal have" — a different question
with a different audience (an agent building the *first* figure for a
journal that has none yet still needs this).

**`GET /api/v2/{user}/travellers/preview?figure={…}` / `?party=[…]`** —
unchanged. Still read-only, still no storage, still the thing that makes the
interview honest ("a person cannot confirm a description they cannot see").

**How they attach to `/figures`:** the natural v2 flow is

1. `GET .../travellers/presets` — read the vocabulary, optionally start from
   a preset (resolved client-side into plain attributes, never a preset
   *name*, per the existing and correct rule).
2. `GET .../travellers/preview?figure={…}` — show the person the picture,
   before anything is written.
3. `POST /api/v2/{user}/figures` with the agreed attributes, a client-chosen
   `id` — writes the `figureDoc` into the library.
4. `PATCH /api/v2/{user}` (journal doc) or the trip document's `figures`
   field references that `id` in a `{mode: "set"/"custom", figures: [id,
   ...]}` block.

Step 2 can also be pointed at an *already-stored* figure
(`?figure={id-lookup}` is not supported today and shouldn't be invented —
`preview` takes attributes, not ids, because it is a drafting tool for
something not yet written; once a figure is saved, its preview is just its
row in `GET /figures` rendered by the same client component the site
already uses, and a second server-rendered preview for a stored id would be
the "one fact, one address" rule violated for no reason).

**`GET /api/v2/{user}/travellers`** and the per-trip travellers routes are
retired — the journal-level and trip-level *choice of which figures walk*
now lives on `journalDoc.figures` and `tripDoc.figures` (the `journalFigures`
/`tripFigures` unions already decided), read and written as part of the
whole journal or trip document. There is no longer a config sub-block to
read separately.

`.../travellers/from-photo` is not part of the decided core's media/figures
schemas and needs its own decision — see open questions (§14) — since it's a
real capability (best-effort figure suggestion from a photo) with no obvious
home in the document-oriented shape: it doesn't write anything itself today,
it proposes attributes for the *next* `POST /figures` call to use, closer in
spirit to `geocode` (a shortlist to choose from) than to a document write.

### Proposed cuts

- **`GET /api/v2/{user}/travellers`** (the standalone journal-default read)
  — cut, subsumed by `journalDoc.figures`.
- **`GET/PATCH/DELETE /api/v2/{user}/trips/{trip}/travellers`** — cut,
  subsumed by `tripDoc.figures` (write via the trip's own PATCH).
- **`preset` as a field name accepted anywhere** — confirmed already refused
  in v1 by design ("a preset name in a trip file is a claim about somebody's
  background... `POST …/trips` refuses a `preset` key by name") and stays
  refused: `figureDoc` in the decided schema has no `preset` field at all,
  so the refusal is now structural (unknown key → 422) rather than an
  explicit check.

### Migration ledger

- `app/api/v1/{user}/travellers/presets/route.ts`,
  `.../preview/route.ts` → renamed under `/api/v2`, unchanged logic
  (`lib/travellers/vocabulary.ts`, `lib/travellers/presets.ts`,
  `lib/travellers/render.ts`, `lib/travellers/parse.ts` all reused as-is).
- `app/api/v1/{user}/travellers/route.ts`,
  `.../trips/{trip}/travellers/route.ts` deleted; their reads move onto the
  journal/trip document GETs (already decided), their writes onto the
  journal/trip PATCH (already decided) plus the new `/figures` library
  writes.
- `.../travellers/from-photo/route.ts` — held pending the open question; if
  kept, moves to `/api/v2/{user}/figures/from-photo` (a figure-library
  action, not a trip one, since a figure now belongs to the journal).
- Data migration: a `travellers:` block on `config.json` or `trip.md`
  becomes one or more `figureDoc`s in a new `figures/` store plus a
  `{mode: "set", figures: [ids]}` reference — this needs a real migration
  script, not a passive dual-read, since v1's inline figures have no `id` of
  their own. Straightforward (each entry gets a generated id, e.g.
  `slugify(name ?? "figure-N")`), but not zero-effort, and every existing
  journal with a `travellers:` block needs it run before v2 figure reads are
  correct for them.

---

## 8. Markdown twins

### Inventory (v1)

`GET /{user}/day/{slug}.md` and `GET /{user}/trips/{trip}/day/{slug}.md` —
not under `/api/` at all; a page-shaped URL with `.md` appended, per
llmstxt.org convention. Routed through `app/api/md/{user}/[...path]`,
gated exactly like the HTML page (`mayReadTrip`, `readerLevelFor`), answers
`text/plain` frontmatter + prose, or `410`/`404` in `text/plain` (never the
HTML error page — B47/B... reasoning: an agent must never have 40KB of markup
land in its context for a mistyped slug).

### v2 design

**Unchanged, deliberately outside `/api/v2`.** This is not part of the
bearer write/read contract (rule 13's four prefixes) — it is a *public,
unauthenticated-by-token* reading surface, gated by the same visibility rules
as the HTML page itself, reachable by a browser, a crawler or an agent with
no credential at all. Folding it into `/api/v2` would either (a) require a
bearer token for something that's supposed to be as open as the page it
mirrors, or (b) special-case `/api/v2` to accept no auth for this one route,
both worse than leaving it exactly where it is.

The one thing worth tightening: the twin's frontmatter vocabulary
(`title`, `date`, `time`, `location`, `country`, `lat`/`lng`, `photos:
<count>`, `weather: true` / the resolved reading, `test: true`,
per-locale blocks) should be generated from `dayDoc`'s own field list rather
than hand-assembled in `render()` (`lib/api/markdownTwin.ts:174-227`) — today
it is a second, manually-kept projection of the day schema, and a field
added to `day.ts` (e.g. a future `tags` echo) has no test forcing the twin
to grow it. Not a functional change, a maintenance one: fold `render()`
into the documentation-generation approach in §9 below, driven by the same
`dayDoc` schema the API reads and writes.

### Proposed cuts

None to the mechanism. The render function should stop being independently
maintained prose (see §9).

### Migration ledger

- `app/api/md/[user]/[...path]/route.ts`, `lib/api/markdownTwin.ts` —
  `markdownTwin()`'s gating and 410/404 handling stay exactly as-is;
  `render()` is rewritten to walk `dayDoc.def.shape` instead of listing
  fields by hand, once the schema-driven doc generator from §9 exists.
- No data migration.

---

## 9. Documentation surface — generated from the schemas

### Inventory (v1)

| Surface | Source |
|---|---|
| `GET /documentation.txt` | `lib/api/documentation.ts` — a hand-written 100+ line generator assembling `agentGuide()`'s sections, the instance's own facts (locales, pricing, capabilities), and a German owner-prompt. |
| `GET /{user}/documentation.txt` | Same generator, journal-scoped section. |
| `GET /skill/{task}.md` (9 slugs) | `lib/api/skillDocs.ts` — cuts `agentGuide()`'s ~140KB rendered text at 40-odd hard-coded `##`/`###` markers (`MARKERS` array) and reassembles named subsets per task. Explicitly designed to avoid a *second* hand-written copy of each fact, but is still fundamentally "one big hand-written prose document, sliced." |
| `/openapi.json` | `lib/api/openapi.ts` — the one surface that is already schema-adjacent (hand-built to mirror the validators, cross-checked by `test/openapi-contract.test.ts`, but not generated *from* a single schema source — v1 has no single Zod source of truth the way v2's `lib/api/v2/schemas/` now is). |

### v2 design

**`GET /api/v2/openapi.json`** — generated, per the phase already implied by
the schemas' own header comment ("in a later ticket") — from
`lib/api/v2/schemas/*.ts` directly via `zod`'s JSON-schema conversion (or
equivalent), so a field that exists only in a schema is a field the document
was never able to omit. This is core infrastructure, not this area's to
design in full, but it is the foundation the rest of this section depends on
existing.

**`GET /api/v2/{user}/docs/{resource}.md`** — NEW, replacing the marker-cut
`skillDocs.ts`. One document per top-level resource (`journal`, `trip`,
`day`, `figures`, `media`, `statements`), generated at request time from:

- the resource's own zod schema (fields, types, enums resolved to their
  named constant, ranges)
- its `Declinable[]` array (`DAY_DECLINABLES`, `TRIP_DECLINABLES`, `JOURNAL_DECLINABLES`)
  rendered as a table: field, why it's asked, how to decline
- a worked example request/response, generated by walking the schema and
  filling representative values (not hand-typed prose — the exact numbers
  can drift from `MAX_TRIP_PEOPLE`, `COST_CATEGORIES`, etc. the way v1's
  hand-written examples occasionally did)
- the refusal table for that resource's routes, pulled from the same
  `errorEnvelope`/error-code registry every route already answers with

This makes the parallel to `/openapi.json` exact: **the human-readable guide
and the machine-readable schema are two renderings of the same source, never
two documents that can disagree.** v1's actual failure mode (a guide saying
"there are five endpoints" while describing thirty, or an example that
silently stopped matching a validator) becomes structurally impossible rather
than caught by a linting test that has to be remembered.

**`GET /documentation.txt` and `GET /{user}/documentation.txt`** stay
hand-written *narrative* — what this instance is, who runs it, the two ways
in, the owner-prompt — because that prose genuinely isn't derivable from a
schema (it's product description, not field description). What changes is
that it stops trying to also carry the field-by-field guide content
(`agentGuide()`'s day-fields table, the trip-fields table, etc.) — those
links point at `/api/v2/{user}/docs/{resource}.md` instead of inlining a
slice of prose that has to be kept in sync by hand.

### Proposed cuts

- **`skillDocs.ts`'s `MARKERS` mechanism** — cut entirely. It was a real
  improvement over duplicated prose (one source, sliced 9 ways) but the
  schema-generation approach is a stronger version of the same idea: instead
  of one prose document sliced by string-matched headings (which breaks the
  moment somebody rewords a heading — `chunksByMarker` throws if a marker
  string isn't found verbatim), the source of truth is the schema itself and
  slicing is "which resource", not "which paragraph".
- **`app/skill/{task}.md`'s task-shaped grouping** (`new-account`,
  `add-a-trip`, `costs`, …, spanning several resources per doc) is
  worth keeping as a *thin composition layer* over the per-resource docs
  rather than dropping task-oriented guides altogether — an agent building
  its first trip wants "here's what a trip needs" assembled from
  `docs/trip.md` + `docs/day.md` + `docs/figures.md`'s declinables, not a
  bare resource list with no narrative order. Recommend keeping the 9 task
  slugs as thin `doc()`-style composers over the new per-resource
  generators, dropping only the marker-cutting internals.

### Migration ledger

- `lib/api/skillDocs.ts` rewritten on top of a new
  `lib/api/v2/docs/{resource}.ts` generator (one per schema file, mirroring
  `lib/api/v2/schemas/`).
- `lib/api/agentCopy.ts` (the shared sentence fragments `documentation.ts`
  and `openapi.ts` both import to avoid disagreeing) shrinks to only the
  genuinely narrative fragments (visibility meaning, guest-link offer,
  owner-prompt) — the field-by-field fragments (`TRIP_FIELDS`,
  `PERFECT_DAY_EXAMPLE`, `PERFECT_TRIP_EXAMPLE`) are retired in favour of
  generated examples.
- `lib/api/documentation.ts` (`agentGuide()`) — the ~140KB monolith itself
  is retired once every task doc it fed is regenerated from schemas; its
  narrative-only remainder (what this software is, the two ways in) folds
  into a much smaller `documentation.ts`.
- No data migration; this is server-side generation only.

---

## 10. Journal lifecycle — the document half

Split with the auth-agent's design: they own the credential half (signup
codes, tokens, the two-step verify → create flow). This section owns what
gets *written* once a journal is created, and what deletion/tombstoning do
to it.

### Inventory (v1)

| Piece | Where |
|---|---|
| `createJournal()` | `lib/journals.ts` — writes `config.json`, mints the signup credit grant, sends the welcome mail, sets initial features |
| `POST /api/v1/journals` | the door: takes a signup token (from `/api/auth/signup/verify`), a chosen username, title, locale, visibility etc., calls `createJournal`, answers with an owner agent token |
| `DELETE /api/v1/{user}` | ask-to-delete: 202 + mail with a single-use button link (`lib/deletions.ts`) |
| `DELETE /api/v1/{user}/trips/{trip}` | same shape, trip-scoped |
| `lib/tombstones.ts` | `content/.deleted/{user}.json` and `.../{user}/{trip}.json` — reserves the name, backs the 410 on every reading surface |
| Reserved-name checks | `lib/users.ts:isReservedUsername`, `site/config.json`'s `users.reserved`, `isDeletedUsername` |

### v2 design

**`POST /api/v2/journals`** — the create door, unchanged in authority split
from v1 (the auth agent's `/api/v2/auth/signup/*` credential flow feeds this
one call a signup token; this design does not redesign that half).

**Edit schema** — this call is unusual in the v2 vocabulary because it is
the *only* place a `journalDoc` is created wholesale by somebody who is not
yet the owner of anything, so its declinable set is deliberately smaller
than `journalWrite`'s full shape — a brand-new journal answers the
minimum and fills in `tagline`/`figures` afterwards via `PATCH
/api/v2/{user}`, rather than being asked everything `journalWrite` asks at
the moment a name is still being chosen. (This is a genuine tension with
rule 2's "ask or decline everywhere" — flagged in open questions, §14: should
create-time itself carry the full `JOURNAL_DECLINABLES` set, forcing
`tagline`/`figures` to be answered-or-declined at signup, or is a narrower
create-time shape with a full `journalDoc` reachable immediately after via
`PATCH` the more honest reading of "two decisions, two calls"? Recommended
default: narrower create-time shape — a person choosing a username has not
yet seen the journal exist, and the same rule that keeps publish separate
from write argues for not overloading the moment of creation with every
optional decision the document ever supports.)

| Field | Type | Class | Notes |
|---|---|---|---|
| `signupToken` | string | required | from the auth agent's verify step |
| `username` | string | required | `USERNAME_RE`, checked against `isReservedUsername` / `isDeletedUsername` |
| `title` | string | required | as `journalDoc.title` |
| `locales` | `string[]` | required | as `journalDoc.locales` |
| `baseCurrency`, `displayCurrencies`, `units`, `visibility` | — | required | mirror `journalWrite`'s always-required fields |

**Read/response:** the created `journalDoc` plus a fresh owner agent token
(`{journal: journalDoc, token: {value, expiresAt}}`) — the "answers with a
usable credential" property v1 already has and should keep, since the
alternative (send another code) is exactly the dead end B... reasoning
elsewhere warns about.

Refusals: `signup_disabled` 404 · `invalid_token` 401 · `username_taken` 409
· `username_reserved` 403 (includes a tombstoned name — see below) ·
`rate_limited` 429 (the created/refused/daily triple-budget shape stays,
it's a genuine anti-abuse control, not a v1 quirk).

**`DELETE /api/v2/{user}`** and **`DELETE /api/v2/{user}/trips/{trip}`** —
**unchanged, per rule 9 (untouchable).** 202, a mail with a single-use link,
never a bearer-completable confirmation. This is already the cleanest
possible door for what it does; nothing about the v2 rules improves it.

### Proposed cuts

- Nothing to cut. Tombstoning, name reservation and the deletion mail flow
  are all sound and already minimal.
- **Worth surfacing that isn't today:** `journalTombstone()`/`isDeletedUsername()`
  currently only ever answer a `410`/`403` at the point something is
  attempted against a dead name. There's no `GET` anywhere that lets an
  agent *check* whether a chosen username is available before spending a
  create call on it — `POST /api/v2/journals` failing with
  `username_taken`/`username_reserved` is the only signal. Recommend (open
  question, §14) a small `GET /api/v2/journals/available?username=X` —
  read-only, no auth needed (it discloses nothing a failed create wouldn't),
  the same shape `geocode` already sets a precedent for as a bare,
  journal-unscoped utility route.

### Migration ledger

- `app/api/v1/journals/route.ts` → `/api/v2/journals`, same
  `lib/journals.ts:createJournal` underneath, request validated by a new
  `journalCreate` schema (narrower than `journalWrite`, per the open
  question above) instead of hand-checked fields.
- `app/api/v1/{user}/route.ts` (`DELETE`) → `/api/v2/{user}`, same
  `lib/deletions.ts:requestDeletion` underneath, unchanged.
- The trip-delete route (not directly inventoried above — same shape,
  `app/api/v1/{user}/trips/{trip}/route.ts`'s `DELETE`, if present, or the
  owner-cookie-only trip delete link at `app/[user]/trips/[trip]/delete/route.ts`
  per AGENTS.md's B1321 note) moves the same way.
- `lib/tombstones.ts` unchanged — no reason to touch a file that's already
  minimal and correctly scoped.

---

## 11. Inbox reading

### Inventory (v1)

| Route | Verb | Does |
|---|---|---|
| `/api/v1/{user}/inbox` | GET | Everything staged, by shelf (`media`, `files`, `photobook`, `postcards`), with counts and total bytes. Journal-wide only. |
| `/api/v1/{user}/inbox` | POST | Stage a file with no trip/day named yet — shared upload logic with the cookie-only `/api/helper/{user}/inbox`. |
| `/api/v1/{user}/inbox/{id}` | DELETE | Remove one staged file, no confirmation (nothing here has ever been on the site). |

### v2 design

The decided core already answers "how many are staged" via
`journalStatus.inbox: {media, files}` — composing with that rather than
duplicating it is the brief's own instruction. What's left for this section
is the *listing and per-item* half `journalStatus` deliberately doesn't
carry (a count, not a manifest).

**`GET /api/v2/{user}/inbox`** — owner only (journal-wide, a trip-scoped
token refused as today — the bucket belongs to the journal, not to any one
trip). Lists the manifest `journalStatus.inbox`'s counts summarise.

| Field (read only) | Type | Notes |
|---|---|---|
| `counts` | `{media, files}` | mirrors `journalStatus.inbox` exactly — same numbers, so a caller who already has a `/status` response can trust this without re-summing |
| `items` | `{media: InboxItem[], files: InboxItem[]}` | each `InboxItem = {id, filename, bytes, stagedAt, ...caption/meta if a sidecar has one}` |

**Uploading into the inbox is no longer its own verb** — it is the media
door with `trip`/`day` declined. `POST /api/v2/{user}/media` with `intent:
{kind: "photo", declined: {trip: "not yet on a trip", day: "camera roll
dump, sorting later"}}` lands exactly where v1's `POST .../inbox` did, using
the one upload door the core already decided rather than a second one with
its own field rules. This is a real behaviour change worth calling out
plainly to the owner: v1's inbox POST asks nothing about trip/day (it is
*for* the case where neither is known yet); v2's media door, per its own
declinable design, requires an explicit decline for both rather than
letting silence mean "goes to the inbox". More typing per stray photo,
traded for one door instead of two — flagged in open questions.

**`DELETE /api/v2/{user}/inbox/{id}`** — unchanged in shape: no
confirmation ceremony (nothing staged has ever been on the site), owner
only.

Refusals: `out_of_scope` 403 (trip-scoped token, both routes) ·
`not_found` 404 (`DELETE` on an unknown id).

### Proposed cuts

- **`postcards`/`photobook` inbox shelves** — present in v1's directory
  layout (`content/{user}/inbox/photobook/`, `postcards/`) per AGENTS.md's
  own content-model listing, but neither v1's `/inbox` route nor
  `lib/inbox.ts`'s `INBOX_KINDS` appears to expose them through this
  door in the code read for this design (only `media`/`files` shelves are
  wired to the API). If that's accurate, there's nothing to carry forward
  here — those shelves are populated and consumed entirely by the
  photobook/postcard pipelines internally and were never part of the public
  inbox contract. Confirm with the owner rather than assumed cut, since it
  wasn't fully traced.

### Migration ledger

- `app/api/v1/{user}/inbox/route.ts` (`GET`) → `/api/v2/{user}/inbox`, same
  `lib/inbox.ts:listInbox` underneath.
- `app/api/v1/{user}/inbox/route.ts` (`POST`) deleted — folded into the
  media door's decline path (already decided infrastructure, not new code
  for this area beyond wiring `intent.declined.{trip,day}` to the inbox
  write path `lib/inboxUpload.ts` already has).
- `app/api/v1/{user}/inbox/[id]/route.ts` (`DELETE`) → `/api/v2/{user}/inbox/{id}`,
  same `lib/inbox.ts:findInboxFile`/`removeInboxFile`.
- `app/api/helper/{user}/inbox/*` (cookie-only room variants, including the
  thumbnail route and `discard`) stay under `/api/web`, unchanged — they are
  browser-internal, not part of this redesign.

---

## 12. Full route table (this area)

| v1 route | Verb | v2 fate |
|---|---|---|
| `.../days/{slug}/publish` | POST | → v2, unchanged shape |
| `.../days/{slug}/unpublish` | POST | → v2, unchanged shape |
| `/{user}/drafts` | GET | cut — subsumed by `/status` |
| `/{user}/import` (`kind: costs`) | POST | split: upload → media door, parse → `GET /statements/{src}` |
| `.../trips/{trip}/costs/import` | POST | → v2 `.../costs/apply`, renamed |
| `.../trips/{trip}/costs` | GET/PUT/PATCH/DELETE | out of this area's scope (budget/prep-costs document, likely folds into `tripDoc.costs` per the decided trip schema — flag for the trip-area design to confirm, not redesigned here) |
| `.../trips/{trip}/track` | POST | → v2, unchanged |
| `.../trips/{trip}/tracks` | GET/PATCH | cut — see §4 |
| `/api/helper/{user}/trip-files` | GET | → `/api/web`, unchanged |
| `/geocode` | POST | → `/api/v2/geocode`, unchanged |
| `/{user}/travellers/presets` | GET | → v2, unchanged |
| `/{user}/travellers/preview` | GET | → v2, unchanged |
| `/{user}/travellers` | GET | cut — subsumed by `journalDoc.figures` |
| `.../trips/{trip}/travellers` | GET/PATCH/DELETE | cut — subsumed by `tripDoc.figures` |
| `.../trips/{trip}/travellers/from-photo` | POST | held — open question |
| `/{user}/day/{slug}.md` | GET | unchanged, outside `/api/v2` |
| `/documentation.txt`, `/{user}/documentation.txt` | GET | unchanged surface, generated content |
| `/skill/{task}.md` | GET | → `/api/v2/{user}/docs/{resource}.md` generators, composed |
| `/api/v1/journals` | POST | → `/api/v2/journals` |
| `DELETE /{user}` | DELETE | unchanged, untouchable |
| `DELETE /{user}/trips/{trip}` | DELETE | unchanged, untouchable |
| `/{user}/inbox` | GET | → v2, unchanged |
| `/{user}/inbox` | POST | cut — folded into media door decline path |
| `/{user}/inbox/{id}` | DELETE | → v2, unchanged |

---

## 13. What's out of scope for this document

- `.../trips/{trip}/costs` (the budget/prep-costs document itself, as
  opposed to the agree-flow that writes onto days) — this is trip content
  the core's `trip.ts` already has a `costs` section for
  (`budget`, `visibility`). Whether the fuller `costs.md` shape (body prose,
  currency-per-item) needs anything beyond what's already in the decided
  schema is the trip area's question, not this one's.
- `/api/v1/{user}/contacts/import` — a different agree-flow (vCard →
  contacts), same shape as costs but a different resource family; belongs
  with the contacts/invites area if one exists, not content.
- The auth agent's signup token flow (`/api/auth/signup/request|verify`) —
  explicitly the auth agent's half per this document's own scoping.

## 14. Open questions

1. **Drafts enrichment** — widen `journalStatus.drafts` rows to
   `{trip, slug, title, test?}`? Recommended default: yes, cheap and avoids
   a follow-up `GET` per draft.
2. **Statement upload/parse split** — should `POST /api/v2/media` with
   `kind: "bank_export"` auto-parse and return the report inline (closer to
   v1's single call), or stay a genuine two-step (`POST /media` then
   `GET /statements/{src}`) as designed above? Recommended default: the
   two-step, for consistency with the media door's own contract ("store
   bytes, answer with an item") — parsing belongs to a `GET`, which is
   naturally repeatable and cacheable, where an upload response is not.
3. **Trip-level day-requirement toggle (`tracks:`)** — cut outright (§4),
   or keep a thinner version that only pre-fills client-side defaults rather
   than gating server-side completeness? Recommended default: cut, per the
   decided schema's own comment — but flagging the real convenience loss
   for long trips honestly rather than pretending it's free.
4. **Journal create-time shape** — narrow (minimum fields, everything else
   via a follow-up `PATCH`) or full `journalWrite` shape with the complete
   declinable set answered-or-declined at signup? Recommended default:
   narrow, as designed above.
5. **Username availability check** — add
   `GET /api/v2/journals/available?username=X`? Recommended default: yes,
   small and removes a wasted create-then-retry round trip that costs
   against the `REFUSED` rate budget for no reason.
6. **Inbox upload via decline** — confirmed acceptable trade (more typing
   per stray photo, one fewer door), or should the media door special-case
   `kind: "photo"` with neither `trip` nor `day` to mean "inbox" without
   requiring an explicit decline pair? Recommended default: require the
   decline — consistent with rule 2, and the "why" it captures (camera roll
   dump vs. genuinely undecided) is worth having on file even for an inbox
   item.
7. **`from-photo` figure suggestion** — keep, and if so under
   `/figures/from-photo` (journal-scoped, since figures are now
   journal-level) rather than under a trip? Recommended default: yes, move
   it to `/figures/from-photo`.
8. **Photobook/postcard inbox shelves** — confirm whether these were ever
   really part of the public `/inbox` contract (traced evidence says no,
   but not exhaustively) before treating their absence from this design as
   a deliberate cut.
