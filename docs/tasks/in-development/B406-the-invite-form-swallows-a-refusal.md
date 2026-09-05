---
id: B406
title: The invite form swallows a refusal, so a reader clicks join and nothing at all happens
type: ISSUE
priority: high
complexity: low
area: contacts
found: "2026-09-05T07:49:39Z"
started: "2026-09-05T08:49:34Z"
session: 62683d95-33a6-4db0-a254-7a8fcbcf014e
claimed: "2026-09-05T08:49:34Z"
---

# B406 — The invite form swallows a refusal, so a reader clicks join and nothing at all happens

## Why

With a journal's `features.mail` switched off, `POST /api/contacts/redeem`
refuses clearly and correctly:

```
{"error":"mail_disabled","message":"This server cannot send the six-digit code
 that redeeming a link needs, so nothing was written and no code was issued —
 including any code you already hold, which is still live. ..."}
```

The invite landing page shows **none of it**. Filling the form and pressing
"Ask to join" leaves the page exactly as it was: same heading, no alert, no
error text, no advance to the code step. Measured on fernscout.ch 2026-09-05 —
`[role=alert]` and `[role=status]` both empty, `<h1>` unchanged.

The reader is left believing they have asked to join. They have not, and
nothing will ever arrive.

The redeem route's own doc comment names this exact failure as the thing it
refuses to ship:

> a redemption form that appeared to work and did nothing leaves somebody
> waiting for a reply that was never coming — the exact failure B37 refused

The server holds that line. The form in front of the reader does not.

This is not only the mail-off case: any refusal this endpoint returns
(`mail_disabled`, and the `202 {"status":"expired"}` branches for a dead or
mismatched link) has to reach the person. Check each one.

## Work

Render the refusal. `mail_disabled` needs wording a reader can act on — it is
not their fault and there is nothing for them to retry — and the expired
branches already have page copy that should be shown rather than swallowed.

## Acceptance

With a journal's mail off, pressing the invite form's submit button shows the
reader that nothing was sent. No refusal from `/api/contacts/redeem` leaves the
page silent.
