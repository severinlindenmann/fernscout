---
id: B1577
title: Six hand-kept key lists in the helper mirror the instance, and nothing fails when one falls behind
type: FEATURE
priority: high
complexity: high
area: content-model, contract, fernscout-helper
found: "2026-09-12T09:06:17Z"
---

# B1577 — Six hand-kept key lists in the helper mirror the instance, and nothing fails when one falls behind

## Why

A field added to this instance has to be remembered in up to five places: the
route that takes it, `lib/api/openapi.ts`, `lib/contentModel/document.ts`, and
then — in the sibling `fernscout-helper` repository — whichever hand-written
key list sends it. Every one of those is a place it can be forgotten, and two
tickets are already the record of it happening: **B1518** (`teaser`, then
`cover`, each accepted locally and silently never sent) and **B1569**
(`ownerTel` and `travellers`, the same shape one level up).

The helper holds **six** such lists today. Only one of them is protected:

| list | mirrors | drift caught? |
| --- | --- | --- |
| `shared/tripFields.mjs` `TRIP_UPDATE_DOORS` | the trip PATCH routes | yes — `validate.mjs:386` warns, B1518 |
| `shared/journalFields.mjs` `JOURNAL_UPDATE_DOORS` | `JOURNAL_PROFILE_FIELDS` (lib/journals.ts:894) | no — B1569 |
| `publish.mjs:434` | the `POST …/trips` body | no |
| `publish.mjs:636` | `EDITABLE_DAY_FIELDS` (lib/api/entries.ts:980) | **no** |
| `shared/contentModel.mjs` `COST_KEYS`, `GALLERY_KEYS` | the model's own key lists | no |
| `shared/costfile.mjs` `CATEGORIES` | `COST_CATEGORIES` | no |

**The day list is the worst of them and has no warning at all.** Add a field to
a day on the instance and `publish` will not send it, will not mention it, and
will report success — which is the exact sentence AGENTS.md keeps coming back
to: *"it was accepted" is not the same claim as "it is there"*.

## What is already there, and what is genuinely missing

Three contracts are already published and already fetched by the helper at run
time — `/openapi.json` (what the API takes), `/api/health` (what the server
offers), `/content-model.json` (which keys a file may carry, B608/W41). The
helper's `contentModel.mjs` already reads the third, with
`content-model.snapshot.json` as the committed offline fallback and
`snapshot.mjs` to refresh it. **The caching, the fallback and the staleness
story all exist; nothing new is needed there.**

What no document states is the **door**: given a key that a file may carry,
which call writes it once the thing already exists — and, for a key that has
none, *why not*. `never-in-file` and `never-over-api` are the closest existing
vocabulary and answer a different question (which side a key lives on), not
this one. `files[x].api` in the document carries a prose sentence per file,
which is the right idea one level too coarse.

The instance already knows the answer in code: `JOURNAL_PROFILE_FIELDS` and
`JOURNAL_FIELD_REFUSALS` (lib/journals.ts), `EDITABLE_DAY_FIELDS`
(lib/api/entries.ts). The trip is the gap — its doors are spread across the
`visibility`, `people`, `travellers`, `rates` and `tracks` routes plus the
general `PATCH`, with no constant naming them.

## Work

**1. One constant per door set, in the instance, imported by the routes.**
`EDITABLE_DAY_FIELDS` is the shape to copy — it already exists and
`openapi.ts` already imports it rather than re-typing it. The trip needs the
same: a `TRIP_UPDATE_DOORS` the trip routes themselves import, so a route and
the document cannot disagree.

**2. A `doors` section in `content-model.json`, derived from those
constants** — never hand-written:

```json
"doors": {
  "trip.md": {
    "create": "POST /api/v1/{user}/trips",
    "update": { "title": "PATCH /api/v1/{user}/trips/{trip}",
                "teaser": "PATCH /api/v1/{user}/trips/{trip}/visibility" },
    "noUpdate": { "id": "addresses the trip rather than describing it" }
  }
}
```

`noUpdate` carries the reason, because a key with no door is not the same as a
key nobody has got to yet, and only the sentence tells them apart. The
instance already has those sentences — `JOURNAL_FIELD_REFUSALS` is three of
them, written for a caller who tried.

**3. The gate, which is the whole point of the ticket.** A test in **this**
repository: for every file in the document, every key in its `known-key` list
appears in exactly one of `update` or `noUpdate`. Add a field to `trip.md` and
CI is red until somebody says which it is. The enforcement has to live where
the field is added; a warning in the helper can only ever notice afterwards,
which is what B1518 settled for and why B1569 happened anyway.

**4. The helper's lists become reads.** `tripFields.mjs` and
`journalFields.mjs` are deleted and their callers read `doors`; `publish.mjs`'s
two hardcoded create lists become the document's own `known-key` list minus
`never-in-file`; `COST_KEYS`/`GALLERY_KEYS`/`CATEGORIES` come from the model and
the enum. Offline behaviour is unchanged — the snapshot already covers it.

**Not doing:** generating the validators, `openapi.ts` or the routes from one
master schema. That is the maximal reading of "define everything once" and it
is the wrong trade here: `lib/validate/*` and the refusal messages carry
reasons, hints and per-field prose that a schema cannot hold, and rewriting
them to be schema-driven would cost the thing this codebase is actually good
at. The aim is one source per *fact*, not one file for everything.

## Acceptance

- Adding a key to `trip.md`'s model without declaring a door fails
  `npm run verify` in this repository, naming the key.
- `/content-model.json` carries a `doors` section for all five files, derived
  from the instance's own constants — no second list anywhere.
- `fernscout-helper` holds no hand-written key list mirroring the instance:
  `tripFields.mjs` and `journalFields.mjs` are gone, and `publish.mjs` sends
  what the document says rather than what it remembers.
- A journal carrying a field added since the helper's snapshot was taken still
  publishes it, with no change to the helper.
- B1518's and B1569's own regressions stay caught.
