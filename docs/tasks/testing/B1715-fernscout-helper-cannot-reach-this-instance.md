---
id: B1715
title: fernscout-helper cannot reach this instance at all since v2, and its own self-test reports green
type: FEATURE
priority: high
complexity: high
area: fernscout-helper, migration
found: "2026-09-14T09:23:10Z"
started: "2026-09-14T10:51:55Z"
merged: "2026-09-14T11:31:49Z"
---

# B1715 — fernscout-helper cannot reach this instance at all since v2, and its own self-test reports green

## Why

`fernscout-helper` is the tool that publishes a journal from a folder on the
owner's laptop. Every write route in it is `/api/v1/*`, and v1's write surface
is gone. A migration of four trips (51 days, 361 photographs) into
`fernscout.ch/severin` on 2026-09-14 was made **entirely by hand** against
`/api/v2` — not one line of the helper could be used.

The findings below are that agent's, recorded in
`fernscout-helper/MIGRATION-FINDINGS.md` and summarised here so this ticket
stands on its own. They are the helper's port, not defects in v2's design — the
route shapes are deliberate. The instance-side defects found in the same run
are B1713 (weather on write), B1714 (`requestBody`), B1716 (`missing_token`)
and B1700 (`/content-model.json`).

| | what the helper does | what v2 serves |
| --- | --- | --- |
| routes | `POST /api/v1/journals`, `/api/v1/{user}/config`, `POST .../trips`, `POST .../days`, per-field `PATCH`es for visibility/rates/people/travellers/tracks | `POST /api/v2/journals`; `GET,PATCH /api/v2/{user}`; `PUT /api/v2/{user}/trips/{trip}` with a client-chosen id; `PUT .../days/{slug}`; one `PATCH` per document; `POST .../days/{slug}/publish` and `/unpublish` |
| optional sections | omitted when the folder has no value | **asked, or declined** — every optional section either sent or named in `declined` with a reason of ten characters or more, else `422 incomplete` |
| "nothing spent" vs "nobody wrote it down" | `without:` / `unrecorded:` | both are `declined` entries; the distinction survives only in the reason text, and it is real content |
| a draft | implied | `status: "draft"` explicitly, or `422` |
| a day's position | `lat:` / `lng:` | `coordinates: {lat, lng}`, `additionalProperties: false` |
| a trip's dates | `start:` / `end:`, plus `status:` and `tracks:` | `dates: {from, to}`; the other two are gone |
| who was on it | inline `travellers:` on the trip | a journal-wide figure library, `PUT /api/v2/{user}/figures/{id}`, max 10 |

Four of these are worse than a rename, and are the reason this is a rewrite
rather than a prefix bump:

- **Trip costs changed meaning.** In v2 a trip's `costs.items` are
  *preparation only* — spent before leaving — and everything spent on the trip
  belongs to its days. `ungarn-2026/costs.md` is line-for-line the same spend
  its own days already carry (27 items each side, CHF 923.60 both), so a naive
  port reports the trip at CHF 1847.20 against a CHF 1000 budget, with no error
  anywhere. `algarve-2026` and `thailand-2025` are the honest shape — flights,
  hotels and a hire car that appear on no day. **A port must not assume
  either.**
- **The exchange-rate convention flipped.** v1: units per 1 unit of the
  journal's base currency. v2: units per 1 EUR. `thailand-2025` carries
  `rates: {USD: 0.801}` and `algarve-2026` `{EUR: 0.9218}`, both in the old
  convention against a CHF base. Neither converts without inventing a number;
  the migration sent `rates.currencies` only and let the server rate it from
  ECB. Anything that copies the old number into `rates.manual` publishes a
  wrong rate that nothing catches.
- **Sync would duplicate the whole journal, not fail.** The helper's own
  `localManifest()` against the migrated folder and its `plan()` against the
  live manifest: 419 local files, 778 remote, **0 paths in common**, verdict
  `{pull: 778, push: 419}`. A day is `entries/<slug>.md` here and
  `entries/<slug>.json` there; a trip is `trip.md` + `costs.md` here and
  `trip.json` there; a photograph is `media/<folder>/01.jpg` here and
  `media/<day-slug>/<hash>.jpg` plus a `.jpg.meta.json` sidecar there. Fixing
  the routes alone turns a dead tool into a destructive one.
- **v2 sync is pull-only.** `GET /api/v2/{user}/sync/manifest` and
  `GET .../sync/file/{path}`, and nothing else. `sync/SKILL.md` promises to
  "send up what changed here"; the upward half goes through the ordinary trip,
  day and media routes, so push and pull are different mechanisms rather than
  mirrors.

And the reason none of this was noticed: **`selftest.mjs` passes every
assertion today.** It exercises local fixtures and `/content-model.json` and
asserts nothing about any route the skills call, while `AGENTS.md` sells it as
"do these tools still agree with the site?". Its green result hid all of the
above. `shared/api.mjs` behaves the same way — it fetches `/openapi.json`,
caches it, reports success, and that document is deliberately scoped to the
surviving v1 and auth doors, so discovery "works" and describes nothing the
helper does. The live contract is `/api/v2/openapi.json`.

One trap for whoever writes the port, and it is not a v2 bug: in folders this
helper produced, a gallery entry's `from:` is the original camera filename and
its `src:` basename is the published number, and the two diverge wherever a
photo was dropped in review. Files under `originals/` are named by `src`.
Keying the upload off `from` silently misses files — it did here, on two
photographs.

What survived the version boundary and should be kept: `shared/frontmatter.mjs`
(parsed all 58 files with no problems, Hungarian and block scalars included);
`contentHash` (SHA-256 hex cut to 32, verified byte-for-byte against three
files pulled through `sync/file` — **not** md5, which is the obvious wrong
guess); `inSync()`'s exclusion of `trips/*/originals`, which is exactly the
boundary the v2 manifest draws; and the manifest's `next` line, which is good
enough prose to show an owner verbatim.

## Work

A rewrite of the helper's write path against v2, in the other repository. In
rough order:

- Point every call at `/api/v2`, and adopt the document shapes: one `PUT` per
  trip and per day with a client-chosen id, one `PATCH` per document, explicit
  publish.
- Carry decline reasons in the folder format, or ask for them. A missing value
  is now a question, not an omission — the helper cannot write a document from
  the folder alone any more. `without:` → "nothing was spent on this day",
  `unrecorded:` → "money was spent but nobody recorded what it went on" is what
  the hand migration used; the two meanings must not collapse into one
  sentence.
- Decide trip costs per folder, never by rule, and say which reading was taken.
- Send `rates.currencies` and let the server rate it; never migrate a v1 manual
  rate.
- Rewrite the sync manifest comparison against the real remote path shapes
  before any sync runs again, and keep the push path honest about being a
  different mechanism.
- Stop trusting `/openapi.json` and `/content-model.json` for discovery — the
  first is scoped to v1/auth by design, and the second is being retired
  (B1700). `/api/v2/openapi.json` is the contract.
- Give `selftest.mjs` at least one assertion per write route the skills depend
  on, so "green" means the site still agrees.
- Read `limits.itemsPerDay` from `/api/v2/status` rather than the hardcoded
  `40` in the working tree's `publish/publish.mjs`.

## Acceptance

- The helper publishes a trip, its days and its photographs into a throwaway
  `test-*` journal on the live instance, with no hand-written call.
- A sync against an already-migrated journal plans `{pull: 0, push: 0}`.
- `selftest.mjs` fails when a write route it depends on is removed from the
  instance.
- The two cost shapes above both round-trip to the right total.

---

## Decided, 2026-09-14 (the owner, before any code)

**1. The folder mirrors the instance's JSON.** `trip.json` with `costs` and
`plan` as sections of it, `entries/<slug>.json`, media under the full day slug
with its `.meta.json` sidecar, `originals/` beside it. The helper stops
translating between two shapes, and B-17 stops being a problem to solve: sync
compares the same paths on both sides because there is only one shape. The
cost, stated: a folder is no longer Markdown somebody reads in a text editor,
and folders written by the old tools need a one-time conversion.

**2. Decline reasons are written in the folder**, in each document's own
`declined` block, authored once and versioned with the content. The helper
never invents one. Publish refuses and names the open section instead.

**3. The whole port, in sequence**, reporting as each stage lands.

## The stages

1. **Foundation** — `shared/api.mjs` against `/api/v2` (discovery from
   `/api/v2/openapi.json`, limits from `/api/v2/status`); retire
   `contentModel.mjs`, its snapshot, `doors.mjs` and the three field lists,
   which mirrored a document that no longer exists (B1700); `journal.mjs`
   reads JSON documents; a converter for a v1 folder; `selftest.mjs` asserts
   every route the skills call still answers.
2. **publish** — `PUT` trip and day with client-chosen ids, `declined`
   carried from the folder, explicit publish, media through
   `POST /api/v2/{user}/media` with `intent.day`, figures, costs read per
   folder rather than by rule, `rates.currencies` only.
3. **sync** — a real mirror now that the paths agree, including the
   originals (B1719).
4. **validate-content** — the disk truths only, plus what the generated
   contract says; no second copy of the field vocabulary.
5. **the rest** — `gps-history`, `statement-costs`, `trip-budget`,
   `icloud-export`, and every `SKILL.md` and `AGENTS.md` sentence that
   describes v1.

---

## Done, 2026-09-14 — merged on fernscout-helper's `main` as `bd134d8`

Five stages, each its own commit, −5408/+2219 lines across 38 files.

**1. The contract reader.** `api.mjs` speaks `/api/v2/openapi.json` and
`/api/v2/status`, and recognises a contract by `info.version === 2` rather than
by it having answered — the one check that would have caught all of this. It
reads the declinables (`x-required-or-declined`) and the limits off what the
server just said, and it handles both `requestBody` and the old `request` key
so it works against the instance before and after B1714. `contentModel.mjs`,
its 761-line snapshot, `doors.mjs`, `pattern.mjs` and the three field lists are
deleted: they mirrored the document B1700 retired, and would have fallen back
to a stale snapshot forever.

**2. publish: 969 lines → 235**, and the deletion is the fix. v1 needed to know
which of eleven per-field doors wrote which key; v2 takes the document, so this
decides create-or-correct and sends what is on disk. `PUT` creates, `PATCH`
corrects with the `If-Match` from the `GET` before it, a photograph is matched
by content hash, the ceiling comes from `/api/v2/status`, publishing stays a
separate call, and a `422 incomplete` prints the server's own list and exits
non-zero — never answered with an invented decline.

**3. sync is a mirror again.** The routes move to v2 and the local walk stops
excluding `originals/`, because the instance stopped (B1719) — the two rules
agreeing is the whole basis on which the client's copy of `inSync()` is allowed
to exist. The zero-paths-in-common problem is gone without being solved: the
folder is the instance's own shape, so there is nothing to translate.

**4. The validator asks the instance.** Every trip and day goes through
`?dryRun=true`, which writes nothing and answers with what would have been
accepted. That cannot drift from the rules the way `model.mjs` did and
`/content-model.json` then did. What stays local is the half no server can
answer: a `src` with no file, a folder no day names, a filename's date against
the document's, two files claiming one slug, a day outside its trip.
`selftest.mjs` now asserts that all 16 routes these skills call are in the
published contract — proved by putting `POST /api/v1/{user}/trips` back into
the list and watching it go red.

**5. The rest.** `gps-history` and `statement-costs` stage through
`POST .../media` with an intent and then call the v2 import, statement and
costs-apply doors; the `track` route stays on v1 with a comment saying why (it
is one of the three the migration kept). `trip-budget` writes JSON documents
instead of doing YAML surgery, and `--before` now means preparation only.
`icloud-export` writes day documents, files photographs under the whole day
slug, and declines what a photograph cannot say. `AGENTS.md`, `README.md` and
six `SKILL.md` files describe the instance that exists.

### The owner's three decisions, all carried out

The folder mirrors the instance's JSON; decline reasons are written in the
folder and never invented; all five stages shipped in sequence.

### Two things found along the way

- **B1729** — Caddy appends `-gzip` to the ETag of anything it compresses, so
  no client that accepts gzip can send a matching `If-Match`, and **every**
  conditional write in v2 answers `409 stale_document` on a document nobody
  touched. Found by the first client that tried to read a day and write it
  back; the helper strips the suffix as a marked workaround until it lands.
- **Two of my own new checks were wrong**, and real content found them: the
  demo journal files photographs under a folder name of its own rather than the
  day slug, and the ten-figure cap is per trip rather than per journal (the
  demo journal holds sixteen). Both fixed before the merge.

### What a person should look at

- `node .claude/skills/shared/selftest.mjs` in fernscout-helper — all green,
  including the route check.
- `node .claude/skills/shared/convert.mjs <user>` against a real v1 folder, and
  the report it prints: the trip-costs comparison and the rate conversion are
  the two lines that need the owner's judgement.
- A `--dry-run` publish of a converted journal against fernscout.ch.
