---
id: B1615
title: "v2 trip routes answer no_such_journal before authenticating, so an anonymous caller can enumerate usernames"
type: SECURITY
priority: high
complexity: low
area: API v2
found: 2026-09-12T00:00:00Z
---

## Why

`GET` and `PATCH` on `app/api/v2/[user]/trips/[trip]/route.ts` and on the
trips-list route call `getUser(user)` **before** they authenticate. So an
anonymous caller with no credential at all gets two distinguishable answers:

- `404 no_such_journal` — no journal of that name
- `401 missing_token` — the journal exists, you just have no token

That is a username oracle. It did not exist in v1, whose equivalents
authenticated first, and it is **inconsistent within v2 itself**: `DELETE` on
the very same route file authenticates before it looks anything up.

Two reasons this matters more here than the usual enumeration finding:

1. A username is a **directory name** and a public URL segment. Knowing one
   exists is the first step to guessing trip ids, which are chosen by hand and
   guessable on purpose — the design already accepts that and compensates with
   the trip gate (B117: a closed trip's sign-in page does not even name the
   trip). An anonymous enumeration door undercuts that compensation.
2. `guest` journals exist precisely so an instance does **not** advertise
   them: not on the landing page, not in `documentation.txt`, not in
   `sitemap.xml`. This route advertises every one of them to anybody who
   guesses the name.

Found by the access-control agent while repointing `test/deletions.test.ts`
during B1612 — the test had to create a real journal to reach the 401 it was
actually about, which is what exposed the ordering.

## Work

Authenticate first, then resolve the journal — matching `DELETE` on the same
file, and v1's own order. The refusal an unauthenticated caller gets must not
depend on whether the journal exists.

Check every route under `app/api/v2/**` for the same ordering, not just the
two named here; the pattern is easy to repeat and this is the moment the
codebase has the fewest of them.

**Do not** simply make the 404 into a 401 — an authenticated caller asking
about a journal that genuinely does not exist should still be told so plainly.
The rule is about what an **anonymous** caller can distinguish.

Not doing: changing v1's routes. They already do this correctly.

## Acceptance

- An anonymous `GET /api/v2/{user}/trips/{trip}` answers identically for a
  journal that exists and one that does not.
- The same for `PATCH`, and for the trips list.
- A test asserts it — the shape that would have caught this is "two requests,
  one real username and one invented, no credential on either, same status
  and same body".
- An authenticated owner asking about a missing journal still gets
  `no_such_journal`.
