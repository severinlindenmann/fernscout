---
id: B1690
title: The deletion confirmation link and the two invite links carry their token in the URL path
type: SECURITY
priority: medium
complexity: medium
area: deletions, invites, Money
found: "2026-09-13T22:00:00Z"
---

# B1690 — The deletion confirmation link and the two invite links carry their token in the URL path

## Why

B1635 fixed the same shape for the credit-approval link: a single-use token as
a path segment (`.../approve/{token}`) reaches the web server's access log,
any proxy log in front of it, and the `Referer` header of anything the page
subsequently loads. That ticket's decision explicitly did not extend the fix
to these two, and named why: they are the same shape but not the same size of
change.

- `app/[user]/delete/[token]/page.tsx` and
  `app/api/v1/[user]/deletions/[token]/route.ts` — a token that destroys a
  journal.
- `app/[user]/delete/[token]/export.zip/route.ts` — the same token authorises
  a **`GET`**, streaming the full export archive. This is the part that makes
  the fix bigger than B1635's: a URL fragment is never sent to a server at
  all, which is exactly what makes it safe for a link but means a `GET`
  cannot read one server-side. A straight port of B1635's approach breaks the
  export download.
- `lib/contacts/invites.ts`'s guest and buddy links
  (`/{user}/invite/guest/{token}`, `/{user}/invite/buddy/{token}`) — lower
  severity, since AGENTS.md is explicit that an invite link "creates a
  request, not access": a leaked, unspent one lets a stranger ask to be let
  in, which the owner still has to approve through `approveContact`. Worth
  fixing in the same pass since whoever picks this up will already be looking
  at the token-in-path pattern, not because it is as serious as the other two.

## Work

For the deletion link: decide between (a) keeping the token in the path only
for the `export.zip` download — a signed one-time download URL living
alongside an otherwise-fragment-based confirmation page is a normal shape,
not a compromise — or (b) making the export a client-driven fetch (read the
token from the fragment, `fetch` the bytes, trigger a save) so nothing ever
puts the token in a URL the server sees. (b) is more consistent with B1635 but
is a bigger change to a page that already carries a summary, a balance,
credits named before they are lost, and the delete button itself; (a) is
smaller and still closes most of the exposure, since the confirmation page
itself — the one a mail scanner or a shared screenshot is most likely to
reach — no longer carries a working credential.

For the two invite links: same choice, on two much simpler pages.

Whichever shape is chosen, keep to B1635's constraints: the token stays
single-use, `Referrer-Policy: no-referrer` on any page still carrying a
credential in its path, and no change to who may confirm a deletion or accept
an invite.

## Acceptance

- A stated decision on (a) vs (b) for the export download, applied
  consistently to whichever of the three links keep a path-based token.
- Every page in this set that no longer carries a token in its path sets
  `Referrer-Policy: no-referrer`.
- `npm run verify` clean.
