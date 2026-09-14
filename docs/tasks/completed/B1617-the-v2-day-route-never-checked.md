---
id: B1617
title: "The v2 day route never checked the weather capability, so a journal with it off stored the request anyway"
type: SECURITY
priority: high
complexity: low
area: API v2
found: 2026-09-12T00:00:00Z
merged: "2026-09-12T21:33:18Z"
completed: "2026-09-14T16:32:11Z"
---

## Why

`weatherOffRefusal` (`lib/api/weather.ts:188`) was called by v1's day route
and by **nothing at all** in v2 — a grep of the whole tree found zero callers.
So `PUT`/`PATCH` on a v2 day accepted `weather: true` on a journal with the
weather capability switched off, wrote it, and answered 200.

`AGENTS.md`'s rule is that every optional capability must be **absent** rather
than broken when disabled. `weather: true` is the one field on a day that asks
the server to *do* something rather than to store what it was sent, so storing
it when nobody will service it is worse than the usual dropped field: the day
sits there with a request that no route and no nightly sweep will ever answer,
and the caller was told it worked.

Found when `test/b775-what-the-software-claims.test.ts` — the suite whose
whole subject is the software not saying untrue things — was repointed to the
v2 routes during B1612. The test was already written; it simply had nothing
calling the guard to catch.

**Fixed in B1612's merge.** This ticket is the record and the follow-up.

## What was done

- The guard is called on both v2 write paths — `PUT` (create) and `PATCH` (a
  correction that adds `weather: true` asks for the same lookup a create
  does).
- `weather_disabled` is now in `ERROR_CODES`. It never was: v1 returned the
  refusal body directly from `weatherOffRefusal` without going through the
  published vocabulary, so the code an agent received was not in the document
  it reads. Now it is.
- Two assertions in the B778 block were rewritten into v2's vocabulary rather
  than deleted. v1 withdrew a lookup with `weather: false`; v2 has no such
  value — `dayWrite.weather` is `true | a reading`, and the `declined` map is
  the one mechanism for "this day has none of that". The property survives the
  change of words: saying a day has no weather must never hit the capability
  refusal, because no lookup is being asked for.

## The second half: it was asked of the wrong thing

The first fix restored v1's check verbatim — `isEnabled("weather", username)`,
per journal. **That was wrong, and the contract already said so.**
`00-decisions.md` §5 and `lib/api/v2/schemas/journal.ts`'s own header both
state that the per-journal `features` block is **instance-only** in v2: a
capability answers *"is the plumbing configured"*, which is the operator's
fact. An archive this server cannot reach is unreachable for everybody on it;
a journal's own config has no business narrowing that.

So every capability check in v2 now asks the instance and takes no username:

| where | was | is |
|---|---|---|
| the day route's weather guard | `isEnabled("weather", username)` | `isEnabled("weather")` |
| `app/api/v2/geocode/route.ts` | `isEnabled("addressLookup", username)` | `isEnabled("addressLookup")` |
| the publish route's notify channels | `isEnabled(channel, user)` | `isEnabled(channel)` |

`weatherOffRefusal` lost its `username` parameter entirely rather than
ignoring it — a parameter nothing reads is the next caller's trap. Its message
also stopped telling the owner to `PATCH /api/v1/<user>/config {"features":
…}`, which is a door v2 does not have.

This is the more interesting half of the ticket: the missing check was an
oversight, but the *per-journal* check was a decision already taken and not
followed. Restoring v1 behaviour verbatim is how a migration quietly undoes
its own decisions.

## Work

**Which other capabilities does a v2 route fail to check?** `weather` was
caught by an existing test that happened to be repointed. v2's routes were
written fresh against the schemas, and a schema says nothing about whether a
capability is switched on — so this class is structural, not a one-off.

Go through `FEATURE_NAMES` in `lib/config.ts` and, for each, find where v1
enforced it and whether v2's replacement does. `costs`, `push`, `reactions`,
`helper` and `transcription` are unchecked in v2 today.

A test in the shape of `test/capability-owner-refusal.test.ts` — every
capability off, every v2 write door driven, nothing accepted that cannot be
serviced — would close the class rather than the instance. **And it should
assert the instance dimension too**: that no v2 route consults a journal's own
`features`, which is the rule this ticket found broken.

## Acceptance

- `PUT`/`PATCH` of a day with `weather: true` on a journal with weather off
  answers `400 weather_disabled` and writes nothing. (Done.)
- Declining weather is never refused by that guard. (Done.)
- Every other capability audited, with either a guard or a written reason it
  needs none.
