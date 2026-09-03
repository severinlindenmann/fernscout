---
id: B81
title: The notify script still calls a closed trip password-protected
type: CHORE
priority: low
complexity: low
area: push, docs
found: "2026-09-01"
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

## Acceptance

- `npm run notify -- --latest --dry-run` on a `guest` trip prints no sentence
  containing "password".
- Nothing else in `scripts/` tells an operator a trip has a password.
- The four checks.
