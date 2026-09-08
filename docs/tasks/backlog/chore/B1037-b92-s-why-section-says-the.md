---
id: B1037
title: B92's Why section says the per-email cap is three; B840 already lowered it to one
type: CHORE
priority: low
complexity: low
area: signup, tasks
found: "2026-09-08T21:42:46Z"
---

# B1037 — B92's Why section says the per-email cap is three; B840 already lowered it to one

## Why

Found while validating B834. `docs/tasks/backlog/small-feature/B92-...md`'s
Why section says "Today an address may own three. `MAX_JOURNALS_PER_EMAIL = 3`
(`lib/journals.ts:74`)" and its Work section proposes "Lower the cap to one."
That part already happened — `git log -S "MAX_JOURNALS_PER_EMAIL = 1"`
attributes the change to `e8a9152e B840: say what it costs, and stop
charging for email`, and `lib/journals.ts:123` reads `= 1` today.

B92's *other* half — letting an owner reclaim their own reserved name via a
matching tombstone after deleting their one journal — is still unbuilt and
still worth doing; this is not a claim that B92 is done, only that its
Why/Work sections describe a cap that no longer exists and will mislead
whoever picks it up next.

## Work

Reread B92, strike the "lower the cap to one" step from Work (done), correct
the Why section's `= 3` to `= 1` with a note that B840 did it, and confirm
the acceptance line about "an address that already owns a journal is refused
a second" still passes today (it should, since the cap already dropped)
before narrowing the ticket to the tombstone-reclaim work alone.

## Acceptance

- B92's Why section names the current cap (1) and the commit that set it.
- B92's Work section no longer asks for a change that has already shipped.
- No code change — this is a task-file correction only.
