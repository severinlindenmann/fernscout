---
id: B580
title: plan.md is checked for existence and never for what is inside it
type: ISSUE
priority: low
complexity: low
area: fernscout-helper, validate-content, plan.md
found: "2026-09-06T14:03:33Z"
started: "2026-09-06T14:12:23Z"
session: ac8af30e-815d-4843-a94d-cf061a70269c
claimed: "2026-09-06T14:12:23Z"
---

# B580 — plan.md is checked for existence and never for what is inside it

## Why

Found on 2026-09-06 while verifying B577.

`validate-content/validate.mjs:252-253` is the whole of what it does with
`plan.md`:

    if (!trip.plan && data.status === "upcoming") {
      tip(`content/${user}/trips/${trip.id}/`, "has no plan.md", MODEL["plan.md"].tip);
    }

So the file is noticed when it is missing from an upcoming trip, and never read
when it is there. Every other file in the model — `config.json`, `trip.md`,
`costs.md`, each entry — goes through the key check that refuses an unknown
key, catches a wrong type, and suggests a correction for a near miss
(`visibilty` → `visibility`). `plan.md` goes through none of it.

`shared/model.mjs` describes `plan.md`'s keys, so the specification exists and
is simply not consulted. A typo in one is silently dropped on publish and the
write still reports success — the same failure B535 describes on the server
side, and the same one the key check was built to prevent everywhere else.

The fixture work for B577 made this concrete: `perfekt` carries a `plan.md`
because it is meant to set every option there is, and no assertion in the
self-test can reach its contents.

## Work

- Run `plan.md` through the same `checkKeys` path as the other files, using
  the entry already in `shared/model.mjs`.
- Give `luecken` a planted fault inside its `plan.md` — an unknown key and a
  wrong type — so the self-test notices if this regresses. Raise the expected
  error floor accordingly.

Not doing: new rules about what a plan should contain. This is about the keys
the model already defines.

## Acceptance

- A `plan.md` with an unknown key is reported as an error naming the key, with
  a suggestion when it is a near miss of a real one.
- A `plan.md` with a wrong type is reported.
- `selftest.mjs` fails if the `plan.md` check is removed.
