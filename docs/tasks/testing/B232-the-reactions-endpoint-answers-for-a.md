---
id: B232
title: The reactions endpoint answers for a trip nobody may read
type: SECURITY
priority: medium
complexity: low
area: api, reactions, privacy
found: "2026-09-04T07:59:28Z"
started: "2026-09-04T08:08:58Z"
merged: "2026-09-04T08:43:24Z"
---

# B232 — The reactions endpoint answers for a trip nobody may read

## Why

`app/api/reactions/route.ts:16` and `:54` resolve the trip with `getTrip` and
stop there. `mayReadTrip` is never called, on either verb.

```ts
if (!tripId || !getTrip(tripId)) {
  return NextResponse.json({ error: "unknown_trip" }, { status: 400 });
}
```

Two consequences, both reachable with `curl` and no credential.

**An existence oracle over a guessable id.** A `private` trip answers `200`; a
trip that does not exist answers `400 unknown_trip`. Trip ids are chosen by
hand and guessable by construction — that is the premise of B117, which took
the trip's *title* off the sign-in gate precisely because "anyone willing to
try a short dictionary against a URL" would otherwise learn it. Every write
route in the codebase is careful about exactly this: `mayWriteTrip` answers 404
for a trip that is not yours *and* for one that does not exist, and
`lib/api/auth.ts` explains at length why. This endpoint hands the answer over.

**Day slugs out of a closed trip.** `getAllCounts` returns a map keyed by day
slug (`lib/reactionSet.ts`, `reactionKey`), and a slug is
`slugify(entry.title)`. So a closed trip that anybody has reacted to also
publishes a lossy copy of its day titles to any anonymous caller. It needs a
reaction to exist, which the POST below supplies.

**And anyone can write those rows.** `POST` gates on the same `getTrip`, so a
stranger can record reactions against days of a trip they may not read. It is
rate-limited by IP and bounded to three emoji, so this is graffiti rather than
disclosure — but it is also what makes the slug leak self-serve if the
attacker already knows a slug.

Separately, and worth folding in: the route never asks
`isEnabled("reactions", username)`. A journal that switched reactions off in
its `config.json` still accepts and reports votes through this endpoint. That
is B165's shape one endpoint over — the capability was in `FEATURE_NAMES` and
nothing on the write path asked.

Found by the B22 sweep; see `docs/security/2026-09-04-sweep.md`.

## Work

**Done.** Both verbs now go through one `resolveReadableTrip()` in
`app/api/reactions/route.ts`, so neither can drift from the other — the old
code had the same `getTrip` check written out twice.

The gate is built out of *sameness* rather than out of refusals, because a
refusal that reads differently only moves the oracle:

- **A trip nobody may read answers exactly as a trip that does not exist.**
  `400 {"error":"unknown_trip"}`, the same body, byte for byte, for a `private`
  trip, a `guest` trip the caller was never invited to, and an invented id. The
  test asserts `real` and `invented` with `toEqual` rather than checking two
  status codes, because that is the property B117 is about.
- **A journal with reactions off answers exactly as a journal that does not
  exist.** `404 {"error":"reactions_disabled", …}` — the idiom
  `app/api/v1/[user]/invites/route.ts` already uses (`!getUser(user) ||
  !isEnabled(…)`), taken whole so that the new capability check cannot become a
  second oracle, this time over journal names.
- **`POST` gets the same gate, not a weaker one.** Writing a row against a day
  is what published the day's slug in the first place.
- A ref that does not parse answers `400 unknown_trip`: it names no journal, so
  there is nothing to disclose and nothing to gate on.

`mayReadTrip` reads the guest cookie. `components/ReactionsProvider.tsx` fetches
same-origin with no `credentials` option, and `fetch` defaults to
`same-origin`, so a signed-in reader's cookie already travels — checked, not
changed.

`getVotesFor` is deliberately left ungated: it is scoped to the journal by
`scopeToJournal` and answers only about the voter id the caller supplied.
Guessing one is a separate, smaller question and is captured as **B239**.

Not done: the reaction set, the voter-id scheme, the rate limit.

## Acceptance

`test/sweep-b22-disclosure.test.ts` was flipped — it asserted the wrong
behaviour on purpose so the suite stayed green until this landed — and now runs
six B232 cases: the two refusals being identical, a `guest` trip refused the
same way, an anonymous vote refused *and recording nothing* (checked by asking
again as the owner), a reader with a live grant still reading and voting, a
public trip unchanged for anybody, and a reactions-off journal answering as a
journal that does not exist.

### Live, against `next dev` on a fixture journal

`ana` is a public journal with `the-quiet-week` (`private`) and `open-2026`
(`public`); `hidden` is a journal with reactions switched off. No cookie, no
token, in either column.

**Before**

```
GET /api/reactions?trip=ana/the-quiet-week   200  {"counts":{},"mine":{}}
GET /api/reactions?trip=ana/no-such-trip     400  {"error":"unknown_trip"}
POST {"trip":"ana/the-quiet-week","day":"a-day-nobody-may-read",…}
                                             200  {"counts":{"❤️":1},"mine":"❤️"}
GET /api/reactions?trip=ana/the-quiet-week   200  {"counts":{"ana/the-quiet-week:a-day-nobody-may-read":{"❤️":1}},"mine":{}}
GET /api/reactions?trip=hidden/anything      400  {"error":"unknown_trip"}
```

The third and fourth lines are the whole finding in two requests: a stranger
wrote a row against a private trip, and the day slug came back to the next
anonymous reader.

**After**

```
GET  /api/reactions?trip=ana/the-quiet-week  400  {"error":"unknown_trip"}
GET  /api/reactions?trip=ana/no-such-trip    400  {"error":"unknown_trip"}
POST {"trip":"ana/the-quiet-week",…}         400  {"error":"unknown_trip"}
GET  /api/reactions?trip=ana/open-2026       200  {"counts":{},"mine":{}}
GET  /api/reactions?trip=hidden/anything     404  {"error":"reactions_disabled",…}
GET  /api/reactions?trip=nobody/anything     404  {"error":"reactions_disabled",…}
```

`npm run build`, `npx tsc --noEmit`, `npx eslint .` and `npx vitest run` all
pass: 138 files, 2165 tests, 3 skipped.
