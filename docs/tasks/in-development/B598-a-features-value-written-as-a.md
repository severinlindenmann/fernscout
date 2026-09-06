---
id: B598
title: A features value written as a bare boolean is silently ignored and nothing says so
type: ISSUE
priority: medium
complexity: low
area: fernscout-helper, validate-content, config
found: "2026-09-06T14:35:01Z"
started: "2026-09-06T14:37:44Z"
session: ac8af30e-815d-4843-a94d-cf061a70269c
claimed: "2026-09-06T14:37:44Z"
---

# B598 — A features value written as a bare boolean is silently ignored and nothing says so

## Why

Found on 2026-09-06 while merging B573.

`config.json`'s `features` block takes an object per capability:

    "features": { "weather": { "enabled": true } }

Write the obvious-looking shorthand instead —

    "features": { "postcards": true }

— and the server refuses it into a `problems` list ("features.postcards must
be an object like { \"enabled\": false }") and falls back to the default,
which for every optional capability is **off** (`parseFeatures` in
`lib/config.ts`). The journal asked for a capability and did not get it.

`validate-content` never looks. It checks the keys of `config.json` against the
model, but not the shape of the values inside `features`, so the shorthand
passes as clean. The repository's own `perfekt` fixture carries
`"postcards": true` today and validates at 0 errors, 0 warnings — while the
fixture's whole purpose is to be the journal with every option set and nothing
wrong. It is not: postcards is off, and nothing anywhere says so.

The same fixture had `"weather": true` until B573, which is how this was
noticed — the weather tip read the journal as not opted in, correctly, and the
fixture had believed itself opted in for as long as it existed.

This is the failure this repository names as its worst kind, in the one place
that is supposed to catch it: a setting that is accepted, reported as fine, and
does nothing. An owner who switches on postcards this way is not told, and
finds out when a postcard does not send.

Related: B580, the same omission for `plan.md` — a file checked for existence
and not for contents. Related: B585, the `apiOnly` blind spot. All three are
the validator not looking somewhere.

## Work

- Check the shape of each `features` value against what the server's
  `parseFeatures` accepts: an object, with `enabled` a boolean. A bare boolean
  is an **error**, not a tip — it is refused by the instance and silently
  reverts to off, which is exactly what `checkKeys` treats as an error
  everywhere else.
- An unknown capability name under `features` should be an error with a
  suggestion, the way an unknown top-level key already is. The server rejects
  those too.
- Fix `perfekt`'s `postcards` entry, and consider whether `perfekt` should
  carry every capability rather than two — it is the fixture that is supposed
  to catch a field the tools do not know about.
- Plant the bare-boolean form in `luecken` and raise its floor.

## Acceptance

- `"features": { "postcards": true }` is reported as an error naming the
  capability and the shape it needs.
- An unrecognised capability name under `features` is reported, with a
  suggestion for a near miss.
- `perfekt` still validates clean, with `postcards` in the correct shape.
- `selftest.mjs` fails if the check is removed.
