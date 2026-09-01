---
id: B40
title: A six-digit code expires in ten minutes, which is shorter than people take to find the mail
type: CHORE
priority: medium
complexity: low
area: auth, mail
found: "2026-09-01"
started: "2026-09-01"
merged: "2026-09-01"
---

# B40 — A six-digit code expires in ten minutes, which is shorter than people take to find the mail

## Why

`CODE_TTL_MS` in `lib/auth/index.ts:37` is ten minutes. That is the whole
window in which somebody has to notice a mail, find it — possibly in spam —
open it on a phone, and read six digits across to another device. The readers
this journal is built for are described elsewhere in this codebase as
"eighty-one" and "opening the site once a month from a link somebody sent
them". Ten minutes is a window sized for a password manager, not for them.

The author's decision: **thirty minutes.**

Worth being explicit about what that does and does not cost, because the
comment on `generateCode` currently justifies the code's length by the window:

> Six digits is 20 bits, which is only safe because it expires in ten minutes
> and burns after five wrong guesses.

The window is not what carries that safety. A code burns after
`MAX_CODE_ATTEMPTS` = 5 wrong guesses whatever the clock says, and
`/api/auth/verify` is rate-limited to 20 attempts per IP per 15 minutes. Five
guesses against a million possibilities is the protection; tripling the window
does not add a sixth guess. What the window actually governs is how long a
*leaked* mail stays useful — someone reading over a shoulder, a shared inbox, a
forwarded message — and that is a real but different exposure, traded here
against people being locked out of their own journal.

So the comment needs correcting along with the constant, or it will be read as
a justification that no longer holds.

## Work

- `CODE_TTL_MS` to thirty minutes.
- Rewrite the `generateCode` comment to say what actually makes a six-digit
  code safe: the attempt counter and the rate limit. Keep the window in the
  sentence as what bounds a leaked mail's usefulness, not as what stops
  guessing.
- The mails say "It works for ten minutes" in three languages — `welcome.*` is
  not affected, but the code mails are. Those strings are English literals in
  the auth routes rather than locale keys; update them where they are.

Not doing: anything to `MAX_CODE_ATTEMPTS` or the verify rate limit. Those are
the controls that matter and they are not being touched.

## What was found while building it

The Work section said the code mails were "English literals in the auth routes
rather than locale keys". Half right, and the half it missed is the reason this
was worth more than a constant change: **"ten minutes" was written out in words
in eleven places** — three locale files (`contact.mailCodeBody`,
`me.signInSent`, in en/de/hu), four mail bodies across two routes, the agent
guide, and five comments including two migrations.

Changing the constant alone would have left every one of them lying, and the
person who found out would have been a reader whose code had expired while the
page said it had twenty minutes left. So the number is now published from the
constant that enforces it — `CODE_TTL_MINUTES` — and the locale strings take
`{minutes}`. This is the same discipline the media limits table already uses,
and the reason it exists.

That threading reached further than expected: `GuestSignIn` is a client
component and `lib/auth` is server-only, so the value is passed as a prop from
`me/page.tsx` through `MePageContent`. Worth knowing before assuming a similar
change is one line.

## Acceptance

- A code issued now verifies 25 minutes later and not 35.
- No mail or document still tells anybody the code lasts ten minutes.
- `generateCode`'s comment no longer claims the ten-minute window is what makes
  six digits safe.
- The existing auth tests pass unchanged — none of them should depend on the
  specific TTL, and if one does, that is worth knowing.
