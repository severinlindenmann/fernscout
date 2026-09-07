---
id: B597
title: A day that declined photographs or coordinates cannot be published a second time
type: ISSUE
priority: high
complexity: low
area: api, days, fernscout-helper, publish
found: "2026-09-06T14:35:01Z"
started: "2026-09-06T14:37:44Z"
merged: "2026-09-06T14:52:04Z"
completed: "2026-09-07T13:12:19Z"
---

# B597 — A day that declined photographs or coordinates cannot be published a second time

## Why

Found on 2026-09-06 by two agents independently, on unrelated tickets (B573 and
B578), then reproduced against the live instance.

`publish.mjs` turns a day's `without:` and `unrecorded:` lines into fields on
**every** write:

    for (const track of entry.data.without ?? [])    body[track] = false;
    for (const track of entry.data.unrecorded ?? []) body[track] = "unknown";

The first publish is a `POST` and succeeds. The second is a `PATCH`, because
the day now exists — and a day carrying `without: [photos]` or
`without: [coordinates]` gets a 400:

    $ curl -X PATCH .../days/drinks -d '{"photos": false}'
    400 unsupported_field
    This call changes "photos" for nobody, and nothing was written. …

`publish.mjs` stops at the first refusal, so the run ends there and every day
after it goes unwritten. `costs` is unaffected — it is in
`EDITABLE_DAY_FIELDS` — which is why the journal this was found on never hit
it: it uses `unrecorded: [costs]`, the one of the three that PATCH accepts.

**Decided 2026-09-06, after reading the contract: the client is wrong, not the
route.** The ticket originally left this open. `openapi.json` is explicit that
`false` is create-only, for both fields, and gives the reason:

> `photos` — "`false`, and only on create — *this day has no photographs*. …
> A trip that tracks photos checks for them at publish rather than here, so
> this is what lets a day without any go up."
>
> `coordinates` — "`false`, and only on create — *this day has no one place to
> put on a map*. The positive answer is `lat` and `lng`; there is no
> `coordinates: true`."

So `false` is an answer given while a day is being written, and the route is
right to refuse it afterwards. A client that re-sends it on every PATCH is
describing the day's creation, not its current state.

The `"unknown"` half is a different matter and is **not** this ticket: nothing
documents it as create-only, and PATCH refuses it anyway because the whole
field is absent from `EDITABLE_DAY_FIELDS`. That is B599.

Related: B245, B572 — the same shape, a file edited after the first publish
that cannot be reconciled by re-sending.

## Work

In `fernscout-helper`, `.claude/skills/publish/publish.mjs`:

- Send `without:` → `false` **only on the create path**. On an update, leave
  those fields out of the body entirely.
- `unrecorded:` → `"unknown"` may still be sent on both, once B599 lands; until
  then `photos`/`coordinates` will be refused there too, so guard on the field
  rather than on the answer, and say in a comment that the guard narrows when
  B599 does.
- `costs` is accepted on both paths and must keep being sent on both — a day
  whose costs were recorded and later removed has to be able to say so.
- If a day's `without:` disagrees with what the instance holds, that is not
  silently re-sendable and belongs in the same warning B572 added for the trip
  fields. Print it; do not fail the run.

Not doing: the route's field list — B599.

## Acceptance

- A journal with a day carrying `without: [photos]` publishes twice in a row,
  the second run succeeding and every later day still written.
- The `halbfertig` fixture — which has two such days — publishes twice against
  a test instance and comes through.
- A day carrying `without: [costs]` still sends `costs: false` on an update,
  demonstrated by a run against a test instance.
- No run stops on `unsupported_field` for a field the file legitimately
  carries.
