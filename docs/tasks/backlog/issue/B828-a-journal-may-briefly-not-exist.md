---
id: B828
title: A journal may briefly not exist while a deploy copies content
type: ISSUE
priority: medium
complexity: medium
area: users, deploy
found: "2026-09-07T15:54:42Z"
---

# B828 — A journal may briefly not exist while a deploy copies content

## Why

B807 — a person's session silently stopped being recognised mid-task — was made
survivable without its cause being found. The deploy theory was ruled out with
evidence: sessions are rows in `sessions`, `lookUpSession` (`lib/auth/index.ts:1055`)
is a pure database lookup, and `hashSecret` (`:208`) is an unsalted SHA-256 that
does not involve `SESSION_SECRET`, so even a regenerated secret would not
invalidate a cookie. A test proves a session survives the database being closed
and reopened, which is what a restart does to this code.

That leaves the standing hypothesis, and it is worth chasing because it would
look exactly like what the tester saw:

`lib/helper/server.ts:33` — `isHelperOwner` returns false when
`getUser(username)` is null. During a deploy, `ship.sh` **rsyncs
`content/example` into the content directory** while the server is running. If
`lib/users.ts`'s cache can observe a journal mid-copy — a directory present but
its `config.json` not yet written, or a cache invalidated at the wrong moment —
then for a few hundred milliseconds that journal does not exist, and every
request for it answers "not your journal".

Two deploys happened during the tester's run, and he saw it twice.

Unproven. But if it is real it affects every journal on the instance during
every deploy, not only the demo, and the answer a person gets is the most
alarming one available.

## Work

Look at `lib/users.ts`'s cache and what invalidates it, and at whether
`getUser` can observe a half-written journal directory. Reproduce by rsyncing a
journal under a running server and hammering `isHelperOwner`.

If it is real, the fix is probably that a journal whose `config.json` cannot be
read is treated as *unavailable* rather than *absent* — a 503 that says try
again, not a 404 that says this is not yours.

## Acceptance

Either the race is reproduced and closed, or the file says why it cannot happen.
