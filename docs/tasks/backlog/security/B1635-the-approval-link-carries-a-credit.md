---
id: B1635
title: "The approval link carries a credit-granting token in the page URL, where logs and Referer can see it"
type: SECURITY
priority: medium
complexity: medium
area: Money
found: 2026-09-13T00:00:00Z
---

## Why

The operator's approval mail carries a link built in
`app/api/web/admin/grants/route.ts`:

```
https://…/{username}/payment/{id}/approve/{token}
```

That token is **single-use and grants credits** — one of only three things in
the codebase that can raise a balance. A URL is written to the web server's
access log, kept in any proxy log in front of it, and sent onward in the
`Referer` header of anything the page subsequently loads. An *unspent* token
sitting in a log is exactly the window that matters, because spending it is
the whole attack.

This is **pre-existing** (B425, unchanged through B792) and not a regression:
`main~25` carries the identical `approveUrl`. What B1622 briefly added was a
*second* copy of the token, in the API call's own path; that half is reverted
in B1636, and this ticket is the half that remains.

Found by the automated security review on 2026-09-13 and confirmed against
the history rather than taken at face value — the finding named the API route,
which was the newer and smaller half of the problem.

## Work

The operator needs a link they can click from a mail, so the token has to
reach the browser somehow. The shape that keeps that and stops the leak:

- put the token in the URL **fragment** — `…/approve#token=…`. A fragment is
  never sent to the server, never reaches an access log, and is not included
  in `Referer`;
- the page reads it from `location.hash` and hands it to the existing
  `POST …/purchases/{id}/approve` body (B1636 already made that the API's
  shape);
- set `Referrer-Policy: no-referrer` on the approval page regardless, so that
  nothing the page loads carries the URL onward.

Check the same shape on the **other** mailed single-use links before deciding
this is one ticket: `lib/deletions.ts`'s confirmation link and
`lib/contacts/invites.ts`'s two invite links are all tokens-in-URLs reached
from a mail. The deletion link is the closest analogue — it destroys a journal
— and if it has the same shape it belongs in the same fix rather than a second
ticket six months later.

Not doing: shortening the token's life as a substitute. A shorter window is
not the same as not writing the credential down.

## Acceptance

- The approval mail's link carries no token in any part the server receives.
- The page still works from a single click in a mail.
- `Referrer-Policy: no-referrer` on that page.
- A stated decision, in this ticket, on whether the deletion and invite links
  share the fix or are deliberately different.
