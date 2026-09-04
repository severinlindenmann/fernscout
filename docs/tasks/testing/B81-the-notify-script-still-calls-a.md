---
id: B81
title: The notify script still calls a closed trip password-protected
type: CHORE
priority: low
complexity: low
area: push, docs
found: "2026-09-01"
started: "2026-09-04T06:22:42Z"
merged: "2026-09-04T06:43:26Z"
---

# B81 — The notify script still calls a closed trip password-protected

## Why

Found while fixing **B70**, and deliberately not absorbed into it: it is a
wrong sentence, not a wrong filter.

`scripts/notify.mts` prints, for any trip `isOpenToLink` refuses:

```
"<title>" is password-protected — only subscribers tied to an approved,
signed-in contact with access to this trip are notified.
```

There has been no trip password since **B39** removed the scrypt hash, the
signed cookie and the unlock form. The second half of the sentence is exactly
right and describes what `subscribersFor` does; the first half names a
mechanism that no longer exists, so the operator running `npm run notify` is
told the wrong reason their audience is small — and, worse, told a password
exists that they might then go looking for.

Same file, same B39 residue as the comments `lib/push.ts` carries about
passwords, which B68 rewrites.

## Work

- Rewrite the message to say what is true: this trip is closed, so only
  subscriptions tied to an active contact holding a `read` grant are notified.
- Grep the rest of `scripts/` and `docs/` for "password" while there; B39
  removed the feature and the word outlived it in more than one place.

## Correction to the Why

The Why understated it. The message is printed for `restricted = !isOpenToLink(trip)`,
which is **both** closed values, and the half the Why calls "exactly right"
is only right for one of them. `subscribersFor` (`lib/push.ts:146`) returns
`[]` outright for a `private` trip — a journal-wide read grant is not a key to
it and nothing here records who was on it (B68) — so for a private trip the
sentence promised an audience of approved contacts where the real audience is
**nobody**. That is a second wrong sentence in the same string, not a second
problem, so it was fixed here rather than captured.

## What was done

`scripts/notify.mts` now branches, because the two closed values narrow the
audience by different amounts:

- `private` — "it belongs to the people who were on it, and nothing here
  records who they were, so nobody is notified at all (B68)."
- `guest` — "only subscriptions tied to a contact of this journal who is
  active and holds a live read grant are notified."

The local `restricted` is renamed `closed`, which is the vocabulary the rest of
the codebase uses (`mayReadTrip`: "whichever way the trip is closed"; AGENTS.md:
"a closed trip does not name itself"). A comment above it records why the word
"password" must not come back.

`scripts/export.mts:8–14` was the other hit in `scripts/`. It described the zip
as including "password-protected ones" and cited **`npm run trip:password` as a
comparable trust level — a script that does not exist**: there is no
`trip:password` in `package.json` and no `scripts/trip-password.mjs`. Now says
"closed ones included", compares against `npm run db:migrate` alone, and
describes the `open-to-link` scope as dropping every trip that is not `public`,
which is what `lib/exportZip.ts` actually does.

`docs/running-locally.md` had two:

- The `SESSION_SECRET` section said it was needed "as soon as a trip carries a
  `passwordHash:`", and that without it "the trip renders its password gate,
  the unlock endpoint answers 503". None of that exists. `SESSION_SECRET` is
  the env requirement of the `auth` and `signup` capabilities
  (`lib/capabilities.ts:21,25`), so without it those report off and
  `/api/auth/request` answers 404 — nobody can prove an address, which is the
  real reason nobody gets in.
- "A locked trip, without touching your own content" told the reader to run
  `node scripts/trip-password.mjs` and paste a scrypt hash next to
  `visibility: guest`, which is incoherent twice over. Rewritten as "A closed
  trip": one word of frontmatter, what `guest` and `private` each mean, and
  what it takes to get past either.

## Deliberately not done

`docs/TESTING.md` section F walks an operator through the whole removed
password flow across four steps, and uses `visibility: unlisted`, which W27
also retired. That is a scenario table to rewrite rather than a sentence to
correct, so it is **B215**.

## Acceptance

- `npm run notify -- --latest --dry-run` on a `guest` trip prints no sentence
  containing "password".
- Nothing else in `scripts/` tells an operator a trip has a password.
- The four checks.
