# Decisions — the law of this migration

Everything below was decided by the owner (Severin) on 2026-09-12, most of
it item by item. Do not re-open any of it; a genuinely new question goes to
the owner with a recommended default.

## Architecture (concept artifact)

1. Zod in Next.js — no FastAPI, no second runtime. One schema per resource
   = validator + type + generated OpenAPI.
2. Document-oriented resources, few doors, whole-document reads/writes.
3. Everything asked-or-declined: `declined: {field: "reason"}` (free text,
   >= 10 chars), silent omission -> 422 listing every open question with
   why_required + how to decline. Conditional questions (asked only where
   they apply, refused where they don't). One field write-and-read (no
   *Resolved twins). One fact, one address.
4. Storage stays markdown; JSON is wire-only.
5. The per-journal `features` block is instance-only now; `startLocation`
   dropped; `units`/`visibility`/`displayCurrencies` required on the
   journal; `manualRates` lives per-trip inside `rates.manual`; storage is
   read-only accounting on the journal read doc -> moved to journalStatus.
6. Four prefixes: /api/v2 (bearer contract) · /api/web (cookie-only) ·
   /api/auth · /api/webhooks.
7. One error envelope from lib/api/errorCodes.ts; client-chosen ids
   everywhere (retry -> 409 with stored doc; media src = bytes hash is the
   one exception); additive-only evolution (no v3); per-token request
   logging (metadata only).
8. Contract layer new, domain layer shared; import-boundary test; one
   writable-fields list per resource shared by /api/web and /api/v2 (T5).

## Field-level decisions (schemas — already IN the code, listed for context)

- Trip: dates{from,to}; visibility always-required; people >= 1 carries the
  buddy question (solo trips decline `buddies`; server mails new people,
  echo reports `notifications` as mails-sent-never-access); teaser required
  true/false on closed trips, refused on public; listed declinable on
  public only; status/tracks retired (derived/subsumed); cover writable,
  NOT asked at create (V8), auto-picked on decline; translations
  {title,tagline,intro} declinable when journal has >1 locale; figures
  {off|journal|custom}.
- Day: 14 asked-or-declined sections; status writable as literal "draft"
  only; captions/photoVisibility folded into media items {src,caption?,
  visibility?}; weather one field both ways (source tells whose; open-meteo
  reserved); media/cover read back with url/effective value in the same
  field.
- Journal: journalWrite (editable) vs journalDoc (read = write + username);
  figures declinable; tagline declinable.
- Figures: journal-level library, client-chosen ids, optional `person`
  email as the future people/buddy-mode hook (mode not shipped).
- Media: per-kind questions (photo: trip/day/caption; exports: trip/format;
  document: trip/caption); wrong-kind questions refused; day-less
  trip-scoped writes supported (T2).
- Status split: GET /api/v2/status (instance: capabilities, limits, media
  formats + importer names, pricing) and GET /api/v2/{user}/status
  (journal + token: credits, drafts+title+test, trips, storage, inbox,
  token scope).
- Patches: dayPatch/tripPatch answer only the questions they raise;
  self-contradiction refused; days immutable via trip; supplying a
  previously-declined section clears the stored decline (T6 — write-path
  invariant, still to implement in routes).

## Area designs (docs/plans/2026-09-12-api-v2/*.md) — accepted with the
synthesis calls S1-S4, tickets T1-T6, and challenge verdicts V1-V13 in the
contract artifact. Highlights that BIND the build:

- S1: ONE day-send door POST .../days/{slug}/send {channels:[...]} —
  send-mail/send-whatsapp/tell-readers all die into it.
- S2/V10: PUT for every client-chosen-id create.
- V1: NO client-held bridge token. The /agent helper reaches v2 through an
  in-process cookie proxy (EditDay pattern); handover-mint refuses short
  tokens.
- V2: dayPatch/tripPatch (done in schemas; routes must honour).
- V3: a NEW declinable section ships advisory (advice[] not 422) until a
  dated enforcement release. Not launch-blocking now (no third parties).
- V6: first-call 422 is the deliberate design; T1 dryRun is the mitigation.
- V11: ETag on document GETs; optional If-Match; stale -> 409 with current
  doc; absent = last-write-wins.
- V12: list endpoints use ?limit=&cursor= / next_cursor; GET trip gains
  ?days=full|summaries|none.
- V13: per-address rate bucket on /api/auth/codes for:"write".
- T1: dryRun flag on every write door.
- C1-C12 cuts all adopted (fulfilment flags deleted; personal invites fold
  into guest; drafts route, tracks routes, travellers routes, inbox POST,
  skillDocs markers, app/api/journal + app/api/trip all die).
- Q1-Q20 defaults all adopted (notably Q1 keys stay ONE mixed door; Q9
  wizard publish quiet-by-default via explicit flag; Q19 clients remember
  standing declines).

## The migration itself (M1-M4, final)

- M1: the DB is DROPPED, fresh start. No table migrates. Everyone signs in
  again.
- M2: only the `example` journal must come back (replayed through v2's own
  API). The owner migrates their own journal later, personally, with the
  replay tool available to them.
- M3: `example` must exercise EVERY feature and be canonically structured —
  it is the acceptance fixture and the demo.
- M4: no overlap, no blue/green. Invite-only ALPHA on the one instance;
  iterative deploys; as fast as possible.
- Migration decline sentence (facts the original never recorded), the one
  honest standard: "not recorded when this was written (migrated from v1)".
