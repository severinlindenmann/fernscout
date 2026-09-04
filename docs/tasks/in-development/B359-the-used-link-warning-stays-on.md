---
id: B359
title: The used-link warning stays on the access page after a successful sign-in
type: ISSUE
priority: low
complexity: low
area: auth
found: "2026-09-04T19:57:28Z"
started: "2026-09-04T21:05:05Z"
session: 62683d95-33a6-4db0-a254-7a8fcbcf014e
claimed: "2026-09-04T21:05:05Z"
---

# B359 — The used-link warning stays on the access page after a successful sign-in

## Why

`/<user>/me`, reached from a spent sign-in link, shows:

> That link had already been used, so it did not let you in. … Ask for a fresh
> code below and it will work.

Right, and well put. It is still on the page after the fresh code has been
entered and the session established — sitting directly above "Signed in as
owner@severin.io", telling the reader they are not in while the rest of the
page shows that they are.

Observed 2026-09-04 on fernscout.ch: the banner survives the whole sign-in
exchange, since it is driven by `?signin=expired` in the URL and the sign-in
happens without a navigation.

## Work

Clear the notice when the session is established — or strip the query
parameter once it has been read.

## Acceptance

Follow a used sign-in link, sign in with a code from the same page, and no
message about the failed link remains.
