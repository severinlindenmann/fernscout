---
id: B447
title: The Home Screen hint says iPhone to somebody holding an iPad
type: ISSUE
priority: low
complexity: low
area: push, i18n
found: "2026-09-05T12:36:16Z"
merged: "2026-09-05T12:40:25Z"
---

# B447 — The Home Screen hint says iPhone to somebody holding an iPad

## Why

`needsHomeScreenInstall()` in `components/PushOptIn.tsx` deliberately catches
iPadOS — it reports itself as a Mac, and the touch points give it away — but
every string behind that branch says *iPhone*: `push.iosInstall`,
`push.install.body`, and the three `push.install.step*` lines through
`PushInstallOnboarding`.

So somebody on an iPad reads an instruction addressed to a phone they may not
own, about a Share menu that is in a different place, and has no reason to
believe it applies to them. The limit is Apple's and it is real on both
devices; only the wording is wrong.

## Work

- `content/locales/{en,de,hu}.json`: say iPhone *and* iPad in `push.iosInstall`
  and `push.install.body`. The step lines name Safari's Share menu, which is
  the same on both, so they need nothing.

Not doing: detecting which of the two it is and branching the copy. Two strings
to keep in three languages, to save a reader four words.

## Acceptance

- No string behind `needsHomeScreenInstall()` names only the iPhone.
- `npm run verify`.
