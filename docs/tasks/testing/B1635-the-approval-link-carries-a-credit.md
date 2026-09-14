---
id: B1635
title: "The approval link carries a credit-granting token in the page URL, where logs and Referer can see it"
type: SECURITY
priority: medium
complexity: medium
area: Money
found: 2026-09-13T00:00:00Z
merged: "2026-09-14T04:54:30Z"
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

## Done

Fixed for the approval link:

- `lib/payments.ts` gains `approveMailUrl(baseUrl, username, paymentId, token)`
  — the one place the link is built — and puts the token after `#token=`.
  `app/api/web/admin/grants/route.ts` calls it instead of building the string
  inline.
- `app/[user]/payment/[id]/approve/page.tsx` moved up a level (the `[token]`
  segment is gone) and is now a thin server component that only checks the
  journal exists. `components/ApprovePreview.tsx` (new, client-side) reads
  `location.hash`, posts the token to a new read-only
  `POST /api/web/{user}/purchases/{id}/approve/preview` to render "approve N
  credits?", then hands the same token to the existing approve POST
  (`ApproveButton.tsx`, unchanged, B1636's body-only shape). The token is
  never in a URL the server receives, at any step.
- The preview route imports `approvableByToken` only, never `grant` — it is
  not a fifth entry for `GRANT_ALLOWED` in `test/credits.test.ts`, and does
  not need to be.
- `next.config.ts` adds `Referrer-Policy: no-referrer` (and `Cache-Control:
  no-store`) for `/:user/payment/:id/approve`, overriding the site-wide
  baseline.

**Decision: the deletion and invite links are deliberately not touched by
this ticket, and it is not one fix.** Both have the identical shape (token as
a path segment), but the size of the change is not identical:

- The credit-approval flow is one page and one POST action. Moving its token
  off the path meant one new read-only preview call and no change to what the
  page can *do*.
- The deletion flow's token authorises a `GET` too —
  `app/[user]/delete/[token]/export.zip` streams the export archive, and a
  `GET` cannot read a URL fragment server-side at all (that is the whole
  point of a fragment). Making that survive would mean either keeping the
  token in the path for the download specifically (a smaller, different
  problem — a signed one-time download token is not a rare thing) or
  redesigning the export as a client-driven fetch-and-save, which is a
  materially bigger change to a page that already carries a summary, a
  balance, credits named before they are lost, and the delete button itself.
- The invite links (`lib/contacts/invites.ts`) grant nothing on their own —
  AGENTS.md: "an invite link creates a request, not access" — so a leaked,
  unspent one lets a stranger *ask* to be let in, which the owner still has
  to approve. That is a real but much smaller exposure than a token that
  mints credits or destroys a journal outright.

Severity order was credits > deletion > invites, and the sweep in
`lib/rateLimit.ts`'s bucket table (B1491) already accounts for the deletion
and confirm buckets separately from this. **B1690 is filed for the deletion
link** (the higher-severity of the two remaining) with this reasoning
attached; the invite links are noted there too rather than given a third
ticket, since whoever picks up B1690 will already be looking at the same
export.zip-shaped problem.
