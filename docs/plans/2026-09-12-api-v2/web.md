# v2 design — the /api/web browser surface

Everything reachable only from a cookie: the `/agent` helper's own backend,
push, `/me`, sync/export, `EditDay`'s doors, deletion confirmation, and the
operator's `/admin`. None of it is `/api/v1` or `/api/v2` today except two
routes that turn out to be misfiled (`sync`, `export.zip`) — see §1.2 and the
cuts.

The organising question for every one of the ~50 routes below is the same:
**does this route exist because the credential is different, or because the
capability is different?** A route that only differs by credential (an owner
standing on their own page, editing what their agent could edit over bearer)
collapses to a thin cookie door in front of the v2 document. A route that
does something no document write could express — spends the owner's own
money, sends a real mail, revokes a session, serves the operator's own
numbers — stays a genuine web-only capability. Six things (postcard send,
photobook order, deletion confirm, credit grant approval, Stripe payment,
admin) were already this shape before v2; the helper's ~40 routes turn out to
be almost entirely the *first* kind wearing the second kind's clothes.

---

## 1. Inventory

### 1.1 The `/agent` helper backend — `app/api/helper/[user]/**` (44 routes)

Every one of these shares one gate: `isHelperOwner(user)` in
`lib/helper/server.ts` — a cookie session only, via `resolveCookieCaller`.
No route here ever reads `Authorization`; several explicitly refuse it with
`403 not_for_agents` rather than silently ignoring it. Refusal for "not
yours" and "doesn't exist" is the same 404 throughout (`notYourJournal`).

| Route | Verb | Does | Model call? |
|---|---|---|---|
| `account` | GET | credit balance, month spend, storage | no |
| `ask` | GET/POST/DELETE | the conversational loop — the one route that drives `answerInThread` | **yes** (`lib/helper/model.ts`, guarded) |
| `channels` | POST | toggle journal's `mail`/`whatsapp` features | no |
| `consent` | POST/DELETE | record/revoke one `HELPER_SCOPES` scope (`words`,`photos`,`speech`,`statement`,`sessions`) | no |
| `contacts/add-me` | POST | add the owner as their own contact, from journal config only | no |
| `contacts/import` | POST | file ticked rows from a staged vCard, each lands `pending` | no |
| `day/attach` | POST | move inbox files onto a day's gallery | no |
| `day/costs` | POST | append one cost line to a day | no |
| `day/describe-photos` | POST | suggest captions for a day's gallery, advisory only | **yes** (`describePhotos`) |
| `day/media` | GET/POST/DELETE | two-phase photo upload (web-resized + original), detach | no |
| `day/publish` | POST | owner-only publish; validates required trip facts first; sends no notifications | no |
| `day` | GET/POST/PATCH | read a day for the wizard; create a draft; edit words/captions/photoVisibility | no |
| `day/remove-photo` | POST | detach one photo | no |
| `day/tell-readers` | POST | send a published day to readers by mail/WhatsApp — a **real send**, no confirmation step | no |
| `day/undo` | POST | swap back to the stashed prior title/content | no |
| `day/unpublish` | POST | take a published day back to draft | no |
| `day/weather` | POST | set `weather:true` and synchronously fetch it | no |
| `day/write-day` | POST | notes → proposed title/prose, writes nothing | **yes** (`writeDay`) |
| `import` | POST | derive a trip's GPS track, or import a staged GPS export | no |
| `inbox/[id]` | DELETE | remove one staged file | no |
| `inbox/[id]/thumbnail` | GET | serve a resized preview of a staged file | no |
| `inbox/discard` | POST | discard one or more staged files | no |
| `inbox` | POST | multipart upload into the inbox | no |
| `invite-contact` | POST | mint a guest invite from a staged vCard's name (never its address) | no |
| `invite/revoke` | POST | revoke a guest invite | no |
| `invite` | POST | mint an unaddressed guest invite | no |
| `journal` | POST | set title/tagline only | no |
| `keys` | GET/POST | list/revoke live agent & handover sessions for this journal | no |
| `photobook` | POST | validate size/cover, hand back the real order page's URL — writes/charges nothing | no |
| `postcard` | POST | write a **pending** postcard order — no charge, no print | no |
| `proposal` | POST | turn a named tool + args into a proposal card without a model call | no |
| `search` | GET/POST | semantic search over a reader-scoped catalogue, filtered to sent ids | **yes** (`findInJournal`) |
| `sessions` | GET | past helper conversations, live session marker, trip list | no |
| `statement/apply` | POST | write agreed cost rows, or preview a staged statement | no |
| `statement` | POST | infer a column mapping for an unrecognised bank export | **yes** (`mapStatementColumns`) |
| `storage/cleanup` | POST | run confirmed cleanup, reclaim space | no |
| `storage` | POST | buy +5GB, spends `EXTRA_STORAGE_CREDITS` | no |
| `transcribe` | POST | voice → text, nothing persisted | **yes** (provider STT, same guard discipline) |
| `trip-files` | GET | lazy-load one trip's photo files for the room UI | no |
| `trip/budget` | POST | set budget / append one prep cost | no |
| `trip/people` | PATCH | add one person to a trip's party | no |
| `trip/rates` | POST | merge one currency's rate | no |
| `trip/reminder` | PATCH | toggle "gone quiet" reminder | no |
| `trip` | POST/PATCH | create a trip; edit title/start/end | no |
| `trip/tracks` | PATCH | set which of `TRACKS` a trip records | no |
| `trip/visibility` | PATCH | change trip visibility/listed/teaser | no |

**The truth-guard boundary is narrow and already correctly drawn**: only
`ask` (`answerInThread`) and `day/describe-photos`/`statement`/`search`
(single-shot model calls) touch `lib/helper/model.ts`. Every other route is
a plain write a *proposal* from `ask` posts to — `ask` is the only place
that can claim something happened, and the only place that needs to be
checked against what the turn actually did (§3.6).

### 1.2 Push — `app/api/push/subscribe/route.ts`

GET (no auth — public: hands back the VAPID key + whether push is on for a
named `user`), POST (register a subscription; identifies the caller via
either browser credential — `resolveAccess`, guest cookie *or* year-long
`fs_identity` — to scope notifications on closed trips), DELETE (unregister,
unauthenticated by endpoint match). Rate-limited. Never touches an agent
token; a service worker has no bearer to send.

### 1.3 `/me` — `app/api/v1/me/**`

- `me/home` (GET) — `fs_identity` only (`resolveIdentity`). Answers `id:
  null` rather than 401 for a stranger (B443 — this fires on every landing
  page load). Lists journals this address may open and devices it is signed
  in on. Includes `admin: isAdminEmail(...)` so the landing page can offer
  `/admin` — grants nothing itself, every admin route re-checks.
- `me/devices/[id]` (DELETE) — `fs_identity` only. Revoke one device's
  identity session, scoped to `listIdentities(email)` so an id cannot be
  used to sign out somebody else.

Despite the `/api/v1/` path, this is **not** the bearer-token contract —
it is cookie-only (`resolveIdentity`, never `authenticate`). Misfiled under
`v1` today; v2 should not repeat the mistake.

### 1.4 Sync — `app/api/v1/[user]/sync/manifest` + `.../sync/file/[...path]`

Both take **bearer** auth (`authenticate`), then `ownsUser` +
`mayActAsOwner` — a trip-scoped token is refused, only the unqualified
owner token works. `manifest` returns every file's path + hash (never
`gps/`, never `originals/`); `file` serves one file's bytes, read-only —
there is deliberately no `PUT`, because a raw file write would bypass every
check the typed day/trip writes run (weather source above all). This is
**already an agent-facing, bearer-token door**, just one that happens to
want the *owner's* credential rather than any scope. It is not cookie
surface and the brief's placement of it in "the browser surface" is the one
correction this document makes: see §3.3.

### 1.5 Export — `app/[user]/export.zip`, `app/[user]/me/export`

- `export.zip` (GET) — **bearer**, `authenticate` + `mayActAsOwner`. The
  whole journal as a zip, drafts and private trips included. Same
  correction as sync: this is agent-facing, not cookie-only, despite living
  under `app/[user]/...` rather than `app/api/v1/...`.
- `me/export` (POST) — **cookie only**, refuses any `Authorization` header
  outright. Calls `requestExport` — rate-limited (3/hour) — which mails the
  owner's own address a single-use link; the mail itself does the whole
  job in one press (no second confirmation, unlike delete, because there is
  nothing irreversible about a copy). This one *is* genuinely web-only: it
  exists because a browser-only owner had no way to ask for the bearer-only
  door.
- `[user]/delete/[token]/export.zip` — the deletion flow's own
  "download first" offer, gated by the same deletion token as the confirm
  page (§1.7), not by session at all. Scope narrows to one trip when the
  pending deletion is trip-scoped (and excludes `config.json` in that case);
  the token is **not** spent by this download, since it has to survive
  being fetched before the delete button is pressed.
- `app/[user]/export/[token]/route.ts` — the destination of the mailed link
  `me/export` sends. `GET`, no session at all — the token in the path *is*
  the credential, and unlike the delete-flow's own export sibling this one
  **is** single-use (`consumeExportToken`, spent on download). `410` if
  invalid or already used. Always whole-journal scope, `config.json`
  included.

### 1.5a `address-lookup` vs `geocode` — two different doors, not a duplicate

`app/api/address-lookup/route.ts` is unauthenticated and public: postal
address autocomplete for a contact/postcard form reached before sign-in,
gated only by a `user` param selecting whether the capability is on for
that journal — it touches no journal content. `app/api/v1/geocode/route.ts`
(§1.10) is the bearer-token door an agent uses to turn a place name into a
day's coordinates. Both real, both stay; neither belongs to this document's
redesign (`address-lookup` has no credential to speak of, `geocode` is
already correctly housed under the bearer contract).

### 1.6 `EditDay.tsx` (B980) and its backend

The component itself writes no field a day did not already carry: it reads
`Draft` from the existing `Entry`, computes a **diff** (`changesFor`) so an
untouched field is never rewritten, and calls, per update actually changed:

- `PATCH /<user>/trips/<trip>/day/<slug>/edit` — cookie-only, `isOwner`,
  refuses any `Authorization` header. Delegates to the **exact same**
  `validateEntryEdit` + `editEntry` the bearer `PATCH
  /api/v1/<user>/trips/<trip>/days/<slug>` uses. `EDITABLE` narrows the
  field list to what the panel draws: `title, time, content, location,
  date, visibility, translations, captions, photoVisibility`. Cannot touch
  `status` — publishing is unreachable from here by construction, same as
  the bearer route.
- `POST`/`DELETE /<user>/trips/<trip>/day/<slug>/photos` — add/remove
  gallery items, same shared writer as the media door.
- `POST /<user>/trips/<trip>/day/<slug>/unpublish` — takedown, its own
  button behind `ConfirmPanel`, never a side effect of Save (B28).
- `PATCH /<user>/trips/<trip>/visibility` — the trip's own audience,
  edited from the day page because that is where the owner is looking at
  both.

This is the cleanest existing example of the pattern the whole helper
surface should be pushed toward: **one validator, one writer, two doors —
bearer for the agent, cookie for the owner correcting it by hand** — and it
already refuses cross-use in both directions (`NOT_FOR_AGENTS` on the
cookie door; the bearer route takes no session).

### 1.7 Deletion confirm — `lib/deletions.ts` (960 lines) + pages

- `DELETE /api/v1/<user>` / `.../trips/<trip>` (bearer, owner-scoped token
  only) — `requestDeletion`: writes nothing, mails the address in
  `config.json` a single-use link, answers `202`.
- `GET/POST /[user]/me/delete` — cookie-only, same `requestDeletion` call,
  reached from the owner's own `/me` page for an owner with no agent at
  all. Refuses `Authorization` outright.
- `/[user]/trips/[trip]/delete` (B1321) — cookie-only, deletes a **trip**
  outright behind one press + inventory shown first (no mail — the owner
  standing there *is* the person the mail would have reached). Still
  refuses any bearer header.
- `/[user]/delete/[token]` (page) + its `export.zip` sibling — the mailed
  link's destination. `resolveDeletionToken` → `confirmDeletion`, the
  **only** place that actually deletes. Single-use (`link_spent` on
  replay), one-hour TTL. `summarise()` counts files/bytes/trips/days/credit
  balance off disk before rendering, so the sentence "three journeys,
  ninety-one days, 1.4 GB" is real, not a description of what's about to
  happen.

### 1.8 Admin — `app/api/admin/*` + `/admin`

Gate: `isInstanceAdmin()` (`lib/adminGate.ts`, wrapping `isAdminEmail` from
`lib/admin.ts` against `FERNSCOUT_ADMIN_EMAIL`) — a **cookie**
(`resolveIdentity`), never a bearer token, and a `404` to everybody else
(not `403` — to a non-operator this surface does not exist). With the env
var unset, every one of these is a 404 for everybody, including whoever
holds the operator's own cookie.

`/admin` (`app/admin/page.tsx`) is a server-rendered page, not an API
route — it reads `dashboard`, `snapshot`, `health`, `attention`, `troubles`,
`allTombstones`, `paymentsPaidSince`, etc. directly (SSR, no client fetch).
Its five mutation actions are the `app/api/admin/*` routes:

- `grants` (POST) — "the operator asks for credits to be added." **Grants
  nothing**: files a zero-franc transaction, mails the operator the same
  single-use approval link an ordinary Stripe purchase mints. The grant
  itself happens at `.../payments/[id]/approve`.
- `refunds` (POST) — **acts immediately**, unlike grants: lowers a balance
  (`clawBack`), moves no money (Stripe is not called — this is the record
  of a refund the operator already issued in Stripe's own dashboard).
- `sms` (POST) — send one SMS from the operator's own number/money.
- `tombstones` (POST) — free a deleted journal's username for reuse. Frees
  a name; restores nothing.
- `acks` (POST) — acknowledge one attention-band entry; lapses the moment
  the underlying number gets worse. Deliberately cannot state its own
  severity (would let an entry silence itself at its worst reading).

### 1.9 Reactions — `app/api/reactions/route.ts`

GET/POST, **anonymous by design** — a voter id in `localStorage`, not an
account. Gated on `mayReadTrip` (so the guest cookie, if present, widens
what a reader can react to) but takes no credential of its own. Every
refusal for "no such trip" and "not yours to read" is byte-identical
(`400 unknown_trip`) to stop the route being an existence oracle over
guessable trip ids; a capability that's off answers exactly like a journal
that doesn't exist (`404 reactions_disabled`).

### 1.10 The unversioned stragglers

- `app/api/journal/route.ts` (`PATCH`) — cookie-side twin of
  `PATCH /api/v1/<user>/config`: same writer (`setJournalProfile`), same
  field list (`JOURNAL_PROFILE_FIELDS`), `isOwner(username, request)`
  instead of a bearer token.
- `app/api/trip/route.ts` (`PATCH`) — cookie-side twin of the trip PATCH
  surface: `patchTripDetails` (title/tagline/start/end — the four fields
  nothing else could ever write until this route existed) and
  `patchTripVisibility`, refusing a body that names both in one call
  (`mixed_change` — each write is a whole-file rewrite).
- `app/api/md/[user]/[...path]/route.ts` — **not owner-gated at all**, and
  not really "web surface" in the credential sense: it's the llmstxt.org
  markdown twin of a public day page, reachable by anyone who could read
  the page itself. Belongs to the *reading* surface, not the write surface
  — out of scope for redesign here (no credential question to answer).
- `app/api/v1/geocode/route.ts` — **already bearer, already under v1**.
  Not a straggler at all; the brief's "if under v1" qualifier resolves to
  "yes, and therefore it's v2 core's business, not mine." Noted for
  completeness, designed nowhere in this document.

---

## 2. v2 design

The redesign for this whole area rests on one move, applied ~40 times: **a
helper route that only writes a document field v2 already owns (day, trip,
journal, media) is deleted, and the `/agent` UI is repointed at
`/api/v2/{user}/...` directly, through a thin same-origin cookie proxy.**
The proxy's whole job is credential translation — cookie in, short-lived
scoped bearer out — plus, for the handful of routes that log into the
truth-guard's turn record, telling the guard what happened. It is not a
second validator and not a second writer.

### 2.1 `POST /api/web/{user}/agent-token` — the cookie→bearer bridge

**Purpose.** Every one of the ~30 plain-write helper routes below exists
today only because `/api/v2` takes a bearer token and the helper UI holds a
cookie. Rather than write 30 thin proxies that each mint their own short
credential, one route mints a **short-lived, owner-scoped v2 token** the
helper's client-side code holds for the rest of that browser tab's session
and sends as `Authorization: Bearer` on every `/api/v2` call directly — no
proxy layer at all for the routes that need nothing else.

- **URL**: `POST /api/web/{user}/agent-token`
- **Credential**: cookie (`isHelperOwner`)
- **Behaviour**: mints a token scoped `owner`, this journal only, TTL short
  enough that a leaked one (XSS, a stray log line) is a bounded exposure —
  30 minutes, refreshed silently by the client before it lapses, exactly
  the pattern the existing 20-minute `handover` credential already
  establishes for the equivalent owner→agent bridge. **Not** the 7-day
  agent token a real agent gets from `/api/auth/verify`: this one never
  leaves the browser tab and is never displayed for a person to copy.

**Edit schema**: no body — the cookie is the whole input.

**Read schema (response)**:

| Field | Type | Notes |
|---|---|---|
| `token` | string | bearer token, 30-minute TTL |
| `expiresAt` | string | ISO instant |

**Refusals**: `no_session` (no cookie), `forbidden` (cookie is a guest's,
not the owner's).

This single route is what lets **21 of the 44 helper routes below simply
not exist in v2** — `channels`, `contacts/add-me`, `contacts/import`,
`day/attach`, `day/costs`, `day/media`, `day/publish`\*, `day` (GET/PATCH
halves), `day/remove-photo`, `day/unpublish`, `import`, `inbox/*` (4
routes), `invite*` (3 routes), `journal`, `keys`, `photobook`, `postcard`,
`storage`, `trip/*` (7 routes) all become the client calling
`/api/v2/{user}/days/{slug}`, `/api/v2/{user}/media`, `/api/v2/{user}/trips/{id}`,
`/api/v2/{user}/figures`, `/api/v2/{user}/invites`, `/api/v2/{user}/keys`
etc. directly, with this token. \* `day/publish` differs from the bearer
publish route only in "send no notifications" — see §3.1, kept as a
distinct v2 field rather than a distinct route.

### 2.2 `POST /api/web/{user}/agent/turn` — the conversational loop

**Purpose.** The one route that cannot become a bare v2 call, because it is
not a document write: it is a model call whose *output* is a set of
proposals over v2 documents, checked by the truth-guard before it reaches
the person. Replaces `ask`.

- **URL**: `POST /api/web/{user}/agent/turn`
- **Credential**: cookie (`isHelperOwner`)
- **Behaviour**: unchanged from `ask` — rate-limited, `refusalFor()`
  matched before any model call, `words` consent required, spends
  `HELPER_TURN_CREDITS`, calls `answerInThread`, streams NDJSON. The tools
  `answerInThread` calls (`lib/helper/tools.ts`) are rewritten to read/write
  v2 documents instead of the v1 functions they call today —
  **mechanically**, since the tools already call `lib/api/entries.ts` /
  `lib/tripWrite.ts` functions that the v2 route handlers will call too; the
  tool layer changes its import, not its shape.

**Edit schema**: unchanged from `ask` — `{said: string (≤2000), today?:
string, selected?: string[]}`.

**Read schema**: unchanged — `{ok, kind, answer, looked[], blocks[],
proposals[]}`.

**Refusals**: `no_session`, `forbidden`, `helper_unavailable`,
`consent_required`, `too_many_requests`, `model_failed`.

### 2.3 Genuine web-only capabilities (kept, redesigned as v2-adjacent doors)

These do something no v2 document write could express. Each moves under
`/api/web/{user}/...` for a consistent prefix, keeps its cookie-only gate,
and is documented (unlike today, where none of `app/api/helper/**` appears
in `lib/api/openapi.ts` at all — see the migration ledger).

**`POST /api/web/{user}/model/write-day`** — notes → proposed title/prose.
Stays separate from `agent/turn` because it is a single-shot, unproposed
call the wizard's first screen uses before a conversation exists.

| Field | Type | Class | Notes |
|---|---|---|---|
| `trip` | string | required | trip id |
| `date` | isoDate | required | |
| `notes` | string | required | free text, what was actually said |
| `location`, `country`, `from`, `to`, `photos` | various | optional | day facts riding the write, never guessed |
| `idempotency_key` | string | optional | replay-safe against the same notes |

Response: `{ok, draft:{title,content}, spent, provider}` — `warnings` is
generated but never leaves the server (B945: warnings are for the guard,
not the reader). Refusals: `consent_required`, `no_credits`,
`too_many_requests`, `model_failed`.

**`POST /api/web/{user}/model/describe-photos`**, **`.../model/classify-travellers`**,
**`.../model/statement-columns`**, **`.../model/search`** — same shape:
single-shot model call, advisory output, writes nothing. Collapse the
existing `day/describe-photos`, (a `classifyTravellers` route the helper
inventory did not surface a dedicated route for — it is called from
`travellers/from-photo` today, unify it here), `statement`, `search` into
one family under `/api/web/{user}/model/*`.

**`POST /api/web/{user}/consent`** / **`DELETE .../consent`** — unchanged
from today's `consent` route. Consent is a statement to a *person*
(informed-consent semantics), not a document field; it does not belong
inside a v2 resource an agent could silently answer on the owner's behalf.

**`POST /api/web/{user}/day/{slug}/tell-readers`** — sends a real
notification to readers. Stays its own door, unchanged: no v2 document
write expresses "and mail everyone right now," and folding it into a day
PATCH would make a field write trigger a send as a side effect (the exact
shape AGENTS.md's mixed_change rule exists to forbid one level up).

**`GET /api/web/{user}/sessions`**, **`GET /api/web/{user}/day/{trip}/{slug}`
(GET half only)** — read-only conveniences for the wizard's own UI state
(past conversations, a day's current words for the "keep/discard" screen).
Kept as thin reads over the same v2 document — not a genuine capability, but
cheap enough and UI-specific enough (`tripTitle` resolution, live-session
marker) not to be worth forcing through the general-purpose v2 GET.

**`POST /api/web/{user}/storage/cleanup`** — runs the confirmed cleanup.
Stays web-only: this deletes files, on the owner's explicit on-screen
confirmation, and is not a document write at all.

**`GET/POST /api/web/{user}/push/subscribe`** — unchanged in shape from
today (§1.2), just re-prefixed for consistency; genuinely credential-mixed
(either browser cookie, or none for the GET) and has nothing to do with the
agent contract.

### 2.4 `/me` — folded under `/api/web`

| Route | Was | Becomes |
|---|---|---|
| `GET /api/v1/me/home` | mislabelled `v1` | `GET /api/web/me` |
| `DELETE /api/v1/me/devices/{id}` | mislabelled `v1` | `DELETE /api/web/me/devices/{id}` |

No behaviour change — both already do exactly what §1.3 describes and both
already correctly refuse a bearer token. The only change is the prefix,
which stops `/api/v1/me/*` from implying (falsely) that a trip-scoped agent
token could ever reach it.

**Read schema (`GET /api/web/me`)**:

| Field | Type | Notes |
|---|---|---|
| `id` | string \| null | opaque identity id, `null` for a stranger |
| `email` | string \| null | |
| `admin` | boolean | whether `/admin` exists for this address — informational only |
| `journals` | array | `{username, title}` this address may open |
| `devices` | array | `{id, publicId, createdAt, lastSeenAt, userAgent, current}` |

Refusals: none — always `200`, `id: null` is the refusal (B443's
reasoning holds unchanged: this fires on every anonymous landing-page load
and a red console line on an ordinary visit is a worse failure mode than an
absent field).

### 2.5 Sync and export — re-housed as owner-scope v2, not web

**Correction to the brief**: both already speak bearer. The redesign is not
"make them cookie doors," it's **"stop implying they're cookie doors by
sorting them under `[user]`/`v1` inconsistently, and say plainly they take
the unqualified owner scope, never a trip-scoped one."**

- `GET /api/v2/{user}/sync/manifest` — unchanged behaviour from §1.4.
  Owner-scope bearer only (`mayActAsOwner`); every refusal is the same
  `404`, including a trip-scoped token, because what leaks otherwise is
  which journals exist on an instance that advertises none. Response adds
  nothing to today's shape (`files[]`, `bytes`, `omitted.originals`, `next`
  hint).
- `GET /api/v2/{user}/sync/file/{...path}` — unchanged. Still read-only,
  still no `PUT` (§1.4's reasoning about `checkWeather` stands
  unweakened — a raw-bytes write door is exactly the shape rule 9 forbids
  re-housing away from).
- `GET /api/v2/{user}/export.zip` — unchanged from today's
  `app/[user]/export.zip`, moved under the `/api/v2` prefix for
  consistency; still owner-scope bearer only, still no anonymous
  fall-through archive (B1086's reasoning is untouched).

**The genuinely web-only halves stay web-only**, unchanged in shape:

- `POST /api/web/{user}/me/export` — cookie-only, mails a single-use link
  to `config.json`'s own address, rate-limited 3/hour. Exists because a
  browser-only owner has no bearer token to call the v2 export with.
- `POST /api/web/{user}/me/delete` — cookie-only, calls the same
  `requestDeletion` the bearer `DELETE /api/v2/{user}` does. See §2.7.

### 2.6 `EditDay`'s backend — collapsed into the day/trip doors it already shadows

Per §1.6, `edit`/`photos`/`unpublish` are already byte-for-byte behind the
same validator/writer as the bearer route. In v2 there is exactly **one**
handler per verb — `PATCH /api/v2/{user}/trips/{trip}/days/{slug}` (merge
patch), the media door, `POST /api/v2/{user}/trips/{trip}/days/{slug}/unpublish`
— and two doors onto each: bearer (`/api/v2`) for an agent, and a **cookie
proxy** for the owner's own browser that does nothing but swap credential
and re-narrow the field list:

**`PATCH /api/web/{user}/trips/{trip}/days/{slug}`** — cookie
(`isOwner`, refuses any `Authorization` header, same as today). Forwards
the body verbatim to the v2 PATCH handler with the owner's bearer minted
in-process (never round-tripped to the client) — same `strictObject` schema
as v2's day merge patch, **minus** `status` and `declined` (a correction, not
a draft-writer, never answers a required-or-declined question the day
hasn't already been asked). `EDITABLE` narrows further to what the panel
draws: `title, time, content, location, date, visibility, translations,
media[].caption, media[].visibility`.

**`PATCH /api/web/{user}/trips/{trip}/visibility`** — cookie proxy over
the trip document's `visibility`/`listed` fields, same narrowing.

**`POST /api/web/{user}/trips/{trip}/days/{slug}/unpublish`** — cookie
proxy over the same v2 unpublish call the bearer route answers.

No new schema: these three inherit `dayWrite`/`tripCreate`'s own tables
verbatim, narrowed by an allow-list. Refusals: `not_for_agents` (bearer
header present), `forbidden` (not owner), plus whatever the underlying v2
write refuses (`invalid_entry`, `unsupported_field`, etc. — same codes,
same meanings, never a parallel vocabulary).

### 2.7 Deletion confirmation — the mail-gate, unweakened, re-pointed at v2 nouns

`lib/deletions.ts` is untouched in substance — rule 9 says these shapes are
untouchable, and nothing here argues for touching them. The only change is
which write each confirmed deletion resolves against (the v2 trip/journal
resource rather than the v1 one), which is a call-site change inside
`confirmDeletion`, not a contract change.

- `DELETE /api/v2/{user}` / `.../trips/{trip}` — bearer, owner-scope only
  (unchanged from `/api/v1`). `202`, mails the link.
- `POST /api/web/{user}/me/delete` (+ `GET` for the summary) — cookie,
  same `requestDeletion`, unchanged.
- `POST /api/web/{user}/trips/{trip}/delete` — cookie, immediate delete
  behind one press (B1321's reasoning — the owner standing there *is* the
  person the mail exists to reach — is unweakened).
- `GET /[user]/delete/{token}` (page) and its `export.zip` — unchanged.
  Not an API route in the `/api/*` sense; stays a page, token-gated, no
  session at all.

**Refusals**: `not_for_agents` (bearer header on a cookie-only door),
`forbidden`, `link_spent`, `gone`. All already in `ERROR_CODES`.

### 2.8 Admin — kept exactly as-is, re-prefixed only

Nothing here should change in substance: it is instance operations, not
journal content, and rule 9's "untouchable" list plus the operator-only,
`FERNSCOUT_ADMIN_EMAIL`-gated, cookie-only, 404-to-everybody-else shape is
correct as built. The only move worth making is consistency: `/api/admin/*`
becomes `/api/web/admin/*` so "everything under `/api/web` is cookie-only"
is a true sentence with no carve-out, and `/admin` (the page) is unchanged
— it was never an API route.

| Route | Was | Becomes |
|---|---|---|
| `grants` | `/api/admin/grants` | `/api/web/admin/grants` |
| `refunds` | `/api/admin/refunds` | `/api/web/admin/refunds` |
| `sms` | `/api/admin/sms` | `/api/web/admin/sms` |
| `tombstones` | `/api/admin/tombstones` | `/api/web/admin/tombstones` |
| `acks` | `/api/admin/acks` | `/api/web/admin/acks` |

No schema change to any of the five. Each keeps its own body shape exactly
as documented in §1.8 — a grant request (`{username, chf}`-shaped, mails
the operator, grants nothing), a refund (`{paymentId}`, acts immediately),
an SMS send (`{to, body}`), a tombstone release (`{username}`), an ack
(`{id}`, no severity field — §1.8's reasoning against a caller-stated level
holds unweakened).

### 2.9 Reactions — kept web-only, unchanged, no v2 role

Reactions have nothing to do with the agent contract — the voter is
anonymous, the write is a vote count, and an agent writing a reaction on
somebody's behalf would be inventing an opinion nobody expressed, which is
exactly the thing forbidden everywhere else in this product. Re-prefix for
consistency (`/api/web/reactions`) and change nothing else. The existing
same-refusal-for-unreadable-and-nonexistent discipline (§1.9) is exactly
the "answer identically" pattern v2's own `unknown_trip`/`forbidden`
distinction already follows elsewhere, so no new principle is needed here.

### 2.10 Unversioned stragglers — resolved

- `app/api/journal/route.ts`, `app/api/trip/route.ts` — **die outright**.
  Both become the cookie proxy pattern of §2.6: a thin `PATCH
  /api/web/{user}` and `PATCH /api/web/{user}/trips/{trip}` that forward to
  the v2 journal/trip PATCH with the owner's bearer minted in-process. No
  behaviour lost — `mixed_change`'s reasoning (visibility and detail fields
  never travel in one call) becomes moot in v2 anyway, since PATCH is a
  merge over the *whole* document and a single call already can carry both
  safely (the whole-file-rewrite hazard that motivated `mixed_change` was a
  v1 storage-layer accident, not a real API concern).
- `app/api/md/[user]/[...path]/route.ts` — **kept, unchanged, out of
  scope**. It is a reading-surface route with no credential question (see
  §1.10); nothing about v2 touches it.
- `app/api/v1/geocode/route.ts` — **out of scope for this document**,
  already correctly housed under the bearer contract. Renumber to
  `/api/v2/geocode` as part of the core migration, not this one.

---

## 3. Proposed cuts

**3.1 — `day/publish`'s "send no notifications" divergence from the bearer
publish route.** Today the helper's publish deliberately differs from
`/api/v1/.../publish` by suppressing the mail/WhatsApp fan-out — reasonable
in isolation, but it means the *same action*, taken through two doors,
behaves differently in a way nothing on screen explains. Recommend: retire
the divergence and make `notify` an explicit boolean the cookie proxy sends
(default `false` when called from the wizard's own publish screen, `true`
when called from wherever the owner explicitly asks "and tell people"). One
route, one behaviour space, no silent door-dependent default. **Owner's
call** — it may be that "the wizard never notifies" is a deliberate product
choice worth keeping as a hard rule rather than a default; argued for
flexibility here because nothing else in the redesign explains *why* the
wizard's publish is quieter than the API's.

**3.2 — `day/undo`.** A stash-and-restore mechanism bolted onto `PATCH` that
exists only because the wizard has no version history and `PATCH` overwrites
in place. Every field it can undo is a field the underlying day document
still carries in its prior form for exactly one edit. Two ways forward:
(a) keep it as a thin web-only convenience (`POST
/api/web/{user}/day/{trip}/{slug}/undo`, unchanged), since it costs one
small file and genuinely has no v2 document expression; or (b) cut it and
let a mis-edit be corrected by editing again, on the theory that "undo my
last correction" is rare enough that a second `PATCH` with the old text
typed back in is an acceptable cost. Recommend (a) — it is cheap, and the
alternative asks a non-technical owner to remember what they just typed
over.

**3.3 — Sync and export's home under `v1`/bare `[user]`.** Not a feature
cut, a housing cut: leaving `sync` under `/api/v1/[user]/sync/*` and
`export.zip` under `/[user]/export.zip` (no `/api/` prefix at all) while
`/api/v1/me/*` is *also* mislabelled `v1` despite being cookie-only means
the prefix currently answers "is this bearer or cookie?" wrong three
different ways in three different directions. §2.4/§2.5 fix all three.
Nothing about behaviour changes; this is purely "the prefix should mean
what rule 13 says it means."

**3.4 — `app/api/journal` and `app/api/trip` (the unversioned PATCH
stragglers).** These predate the cookie-proxy pattern `EditDay`'s own doors
now demonstrate cleanly (§2.6) and duplicate, by hand, what that pattern
would give for free. Cut in favour of the generic proxy — see §2.10.
Replaces to: the cookie-proxy family in §2.6/§2.10. Nothing lost.

**3.5 — The `HELPER_SCOPES` "sessions" consent.** Listed among
`words`/`speech`/`photos`/`statement`/`sessions` in `lib/helper/consent.ts`
but not surfaced anywhere in the route inventory above as gating anything
found. If nothing reads it, it is an inert field per rule 8 and should be
cut, or the route that should be checking it (perhaps `sessions` GET
itself, reading past conversations) should be identified and wired.
**Owner's call** — this needs one grep this document did not have budget
for; flagged rather than resolved.

**3.6 — Collapsing the four "model advisory" routes into one
`/api/web/{user}/model/{job}` family (§2.3).** Not a behaviour cut, a
shape cut: today each of `describe-photos`, `statement`, `search`, and the
travellers-from-photo classifier is its own route with its own credit
constant, rate limit, and consent scope, hand-duplicated four times. A
single family with `job` as a path segment and each job's own schema keeps
the differences (different consent scope, different credit cost, different
response shape) where they belong — in the job's own schema — without four
copies of the surrounding plumbing (rate limit, idempotency, refund-on-
throw). **Owner's call**: whether the four jobs' schemas are similar enough
to share one route file, or different enough (photos vs. a CSV sample vs. a
free-text query) that one route per job reads better even with the
duplication. Argued for the family because the *plumbing* — not the
schema — is what's duplicated.

---

## 4. Migration ledger

**Delete outright** (behaviour absorbed into `/api/web/{user}/agent-token`
+ direct `/api/v2` calls from the helper's own client code):

```
app/api/helper/[user]/channels/route.ts
app/api/helper/[user]/contacts/add-me/route.ts
app/api/helper/[user]/contacts/import/route.ts
app/api/helper/[user]/day/attach/route.ts
app/api/helper/[user]/day/costs/route.ts
app/api/helper/[user]/day/media/route.ts
app/api/helper/[user]/day/publish/route.ts        (folds into v2 publish + notify flag, §3.1)
app/api/helper/[user]/day/route.ts                (GET/PATCH halves → v2 day doc)
app/api/helper/[user]/day/remove-photo/route.ts
app/api/helper/[user]/day/unpublish/route.ts       (→ cookie proxy, §2.6, if kept as EditDay's own; the standalone wizard version dies)
app/api/helper/[user]/import/route.ts
app/api/helper/[user]/inbox/**                     (4 files → v2 media door)
app/api/helper/[user]/invite-contact/route.ts
app/api/helper/[user]/invite/**                    (2 files → v2 invites door)
app/api/helper/[user]/journal/route.ts
app/api/helper/[user]/keys/route.ts
app/api/helper/[user]/photobook/route.ts
app/api/helper/[user]/postcard/route.ts
app/api/helper/[user]/storage/route.ts
app/api/helper/[user]/trip/**                      (7 files → v2 trip doc)
app/api/journal/route.ts                           (→ §2.6 cookie proxy pattern)
app/api/trip/route.ts                              (→ §2.6 cookie proxy pattern)
```

**Rewrite, keeping shape** (rename prefix, no schema change):

```
app/api/v1/me/home/route.ts                → app/api/web/me/route.ts
app/api/v1/me/devices/[id]/route.ts        → app/api/web/me/devices/[id]/route.ts
app/api/v1/[user]/sync/manifest/route.ts   → app/api/v2/[user]/sync/manifest/route.ts (no auth change — already bearer)
app/api/v1/[user]/sync/file/[...path]/route.ts → app/api/v2/[user]/sync/file/[...path]/route.ts
app/[user]/export.zip/route.ts             → app/api/v2/[user]/export.zip/route.ts
app/api/admin/*                            → app/api/web/admin/*
app/api/reactions/route.ts                 → app/api/web/reactions/route.ts
app/api/push/subscribe/route.ts            → app/api/web/push/subscribe/route.ts
```

**Rewrite, split validation from write** (the tool layer, `lib/helper/
tools.ts`, currently calls v1 write functions directly; each tool's read/
write half is repointed at the v2 schema's `checkRequiredOrDeclined` +
handler instead — a mechanical import swap per tool, not a redesign of the
tool registry itself, since `AREAS`/`toolSchemas()` already model "what can
this turn do" independently of which document version answers it):

```
lib/helper/tools.ts        — every tool's write call, repointed at v2 handlers
lib/helper/thread.ts        — unchanged; still the proposal/write log the guard reads
lib/helper/model.ts         — unchanged in full (§ below)
```

**Kept exactly as-is:**

```
lib/deletions.ts
lib/admin.ts, lib/adminGate.ts, app/admin/**
lib/reactions.ts
lib/push.ts
```

**Quirks that die:**

- The `/api/v1/me/*` misnomer (cookie routes under a bearer prefix).
- `sync`/`export.zip` living outside `/api/`-anything consistency.
- Four near-identical "model advisory" route bodies (§3.6, if the owner
  takes the recommendation).
- The wizard-publish/bearer-publish notification divergence (§3.1, if the
  owner takes the recommendation) — becomes one explicit field instead of
  two silently different code paths.

**Data migration**: none. Every route in this area writes through the same
markdown-on-disk storage v2's core already assumes; nothing here introduces
a new on-disk shape. `lib/helper/consent.ts`'s file store, `lib/push.ts`'s
subscription table, and `lib/adminAcks.ts`'s ack rows are all untouched.

---

## 5. The truth-guard net — how it survives migration

**The guard does not read HTTP responses, so moving what's behind the
routes changes nothing it depends on.** `lib/helper/model.ts`'s `amiss()`
checks the model's *prose* against three pieces of turn-local state the
server already holds in-process: `looked` (which read tools actually ran
this turn), `proposals` (what write tools drafted, and whether any exist at
all), and `written`/`writtenThisTurn` (notes pushed into the thread log by
the tools' own call sites, `lib/helper/thread.ts`'s `wrote()`/`refused()`).
None of that is an HTTP status code or a route's JSON body — it's function
return values and thread-log entries assembled *inside* the same request
that calls the model. Rewriting a tool's `run()` to call
`checkRequiredOrDeclined` + a v2 handler instead of a v1 one changes *what
data comes back*, not *whether the guard sees that it came back*.

**Three points in the migration that do need attention, precisely because
they're new claims a v1-era guard has never had to check:**

1. **`declined` is a new kind of claim.** v1 has per-field decline
   encodings (`costs: false`, `"unknown"`) the guard already has no opinion
   about, because nothing in the prompt ever says "I declined X." v2's
   `declined` map is *editorial* — a tool that writes `declined.costs: "..."`
   on the owner's behalf is asserting the owner chose not to answer
   something, which is close kin to the claims `amiss()` already guards
   (`invented`, `dropped`): a model that declines a required section without
   the person having said anything about it is inventing a decision, not a
   fact, but the shape of the failure — a confident sentence about
   something nobody actually decided — is the same one B920 exists to
   catch. **New check needed**: a `declined` matcher, in the same family as
   `invented`/`dropped` — did the turn's own read tools or the person's
   message actually raise the topic being declined, or is the model closing
   a required question on its own initiative? Flag per rule "adding a tool
   may mean adding a check": every write tool that can now send `declined`
   is a tool that has gained a new claim to make falsely.

2. **The 422 `incomplete` body is new and model-facing.** v2's
   `checkRequiredOrDeclined` failure mode is structured (`missing[]` with
   `why_required`, `to_provide`, `to_decline`) rather than v1's ad-hoc
   `incomplete_day`/`missing`. The tool layer needs to translate that 422
   into something the model can act on *without* it becoming a new claim
   surface — the safe move is: the tool call fails, the model is told which
   fields are missing and how to ask about each, and nothing about "this was
   declined" enters the model's own prose until a person has actually
   answered. That is a tool-implementation detail, not a new guard, provided
   the tool never manufactures a `declined` entry to satisfy the 422 on its
   own — which is exactly what check (1) exists to catch if it ever
   happens.

3. **The cookie-proxy routes (§2.2, §2.6) never call the model and need no
   guard at all** — `amiss()` fires only on `answerInThread`'s own output,
   never on a plain PATCH. This is worth stating because it is easy to
   over-apply the guard by analogy ("this is a write route now, shouldn't
   it be checked too?") — the guard's whole design is that it checks *what
   a model said*, and a cookie proxy that forwards a person's own typed
   edit to the v2 PATCH has no model in the loop to be honest or dishonest
   about anything.

**Net effect: zero lines of `lib/helper/model.ts` change for the routes
this document collapses.** The one real addition is the `declined` matcher
in point 1, which is additive (a new entry in `amiss()`'s check list, same
four-part shape as every existing one — matcher, turn-condition, retry,
plain sentence) and is owed independently of this migration the moment any
tool gains the ability to answer a required-or-declined question on the
owner's behalf, which v2's design makes newly possible everywhere at once.

---

## 6. Open questions

1. **§3.1 — should the wizard's publish notify readers by default?**
   Recommend: make it an explicit field the caller states, defaulting to
   the wizard's current quiet behaviour, rather than two routes that
   silently disagree.
2. **§3.2 — keep `day/undo` as a small web-only convenience, or cut it and
   rely on re-editing?** Recommend: keep, it's cheap and forgiving of a
   non-technical owner's mistake.
3. **§3.5 — is the `sessions` consent scope in `HELPER_SCOPES` live
   anywhere?** Needs a grep this document didn't budget for; if dead, cut
   it as an inert field (rule 8).
4. **§3.6 — one `/api/web/{user}/model/{job}` route family, or four
   separate route files?** Recommend: one family, since the duplication
   that motivates the cut is in the surrounding plumbing (rate limit,
   idempotency, refund-on-throw) rather than in each job's own schema,
   which stays distinct either way.
5. **The `declined`-matcher guard (§5.1) — build now, alongside the v2
   migration, or as a follow-up once a tool actually starts sending
   `declined`?** Recommend: build it in the same change that gives the
   first tool the ability to write `declined`, per AGENTS.md's own rule
   ("adding a tool may mean adding a check") — never ship the capability
   and the check in separate tickets, since that is exactly the gap B829's
   whole line of fixes exists to close.
