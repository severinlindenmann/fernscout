---
id: B1246
title: A root-owned content/.registry silently breaks every signup on the instance
type: ISSUE
priority: high
complexity: low
area: signup, ops
found: "2026-09-10T09:12:51Z"
started: "2026-09-11T04:33:21Z"
session: 13f12910-ff28-4566-894a-9e2b3d055281
claimed: "2026-09-11T04:33:21Z"
---

# B1246 — A root-owned content/.registry silently breaks every signup on the instance

## Why

Between 06:09 and 11:15 on 2026-09-10, **nobody could create a journal on
fernscout.ch.** Every `POST /api/v1/journals` died with

```
Error: EACCES: permission denied, open
'/var/lib/fernscout/content/.registry/email/<hash>.json'
```

`content/.registry/` and both its subdirectories were `root:root`. The app runs
as `fernscout`, so `lib/registry.ts` could not claim the address and journal
creation failed. The directory is created lazily by whichever process writes it
first — and `npm run registry -- reconcile` (`scripts/registry.ts`) run over ssh
as root is exactly that process. It was run at 06:09; the outage began at 06:09.

Nothing announced it. `/api/health` stayed `status: ok` with `content: ok` (see
B1248), and the person at the wizard was told only *"That did not work: unknown"*
(B1247). It was found by driving the signup flow by hand, five hours later.

The instance was repaired during that run with
`chown -R fernscout:fernscout /var/lib/fernscout/content/.registry`, so this
ticket is about the hole, not the outage.

## Work

The registry directory is disposable by design and created on demand, which is
what makes ownership drift easy. Pick the smallest guard that actually holds:

- `scripts/registry.ts` is a shell entry point that a root shell will keep
  reaching for. Make it refuse, or fix up ownership, when it is run as a uid
  that is not the one owning `contentRoot()` — a `process.getuid()` check
  against `fs.statSync(contentRoot()).uid`, refusing with the `chown` line to
  run rather than writing files the app cannot read back.
- Consider whether any *other* `npm run` script writes under `CONTENT_DIR` and
  has the same shape (`weather:update`, `gps`, the importers). One guard in a
  shared helper beats one per script.
- Not in scope: making `.registry` writable by everyone, or moving it out of
  `CONTENT_DIR`.

Health is B1248; the wizard's error message is B1247. This ticket is the
ownership hole alone.

## Acceptance

- Running the reconcile script as a user other than the content owner does not
  leave a directory the app cannot write; it refuses and says what to run.
- A test that fails today: create a temp content root owned by the current
  user, chmod its `.registry` unwritable, and assert journal creation surfaces a
  named error rather than a raw `EACCES`.
