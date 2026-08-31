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
