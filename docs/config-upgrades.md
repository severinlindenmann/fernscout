# Config upgrades

`content/config.json` — the server-wide file, not a user's own
`content/<username>/config.json` — carries a `configVersion` field. It exists
so that a `git pull` six months from now, into a content folder nobody has
touched since, fails with a message naming the problem instead of a stack
trace from deep inside `lib/config.ts` or a page that silently renders wrong.

The check runs once at boot (`instrumentation.ts` → `lib/configVersion.ts`),
before anything else that reads config, and before the database or capability
checks — so a version mismatch is always the first thing reported, not the
most confusing.

## If you hit the message

1. Read the entry below for the version your file declares (or `1` if it
   declares none — that's what every file predating this mechanism describes).
2. Make the change it lists.
3. Set `"configVersion"` to the number the running build expects — the error
   message names it.

A config missing `configVersion` entirely is read as version `1` and needs no
action until the changelog below moves past it.

## Changelog

### 1 — initial version (W21)

The field itself. No shape change — every `content/config.json` written before
this package already matches version 1. Adding the field is optional right up
until a future version bump; from then on a file still on an old version stops
the server at boot with a message pointing back here, rather than starting up
against a schema it no longer matches.

## Outside configVersion

Everything above is about `content/config.json`, the server-wide file, and
its boot-time version check. A user's own `content/<username>/config.json`
carries no `configVersion` at all — it is validated at parse time instead, so
a shape `lib/config.ts` no longer recognises surfaces as a `ConfigError`
naming the field, not as a version mismatch at boot. The entry below is one
of those: a change to the user config, not a `configVersion` bump, and not
something setting `"configVersion"` fixes.

## W37 — `travellers` and `ownerEmail` become `owner`

A user's `content/<username>/config.json` named its people twice. `travellers`
was a journal-wide display list, so every trip in a journal was credited to the
same people whether or not they were on it; `ownerEmail` beside it was the real
identity, with no relationship to the list.

Before:

    "ownerEmail": "alex@example.com",
    "travellers": [
      { "name": "Alex Berger", "nickname": "Alex" },
      { "name": "Robin Berger", "nickname": "Robin" }
    ],

After:

    "owner": { "name": "Alex Berger", "nickname": "Alex", "email": "alex@example.com" },

Everyone else who was on a trip belongs in that trip's `people:` block in
`trip.md`, which already decides who may write to it and now also decides who
the trip is credited to:

    people:
      - { name: "Robin Berger", email: "robin@example.com", nickname: "Robin" }

`owner.email` stays optional; a journal without one is read-only, as it was
without `ownerEmail`.
