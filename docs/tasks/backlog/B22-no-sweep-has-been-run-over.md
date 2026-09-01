---
id: B22
title: No sweep has been run over the code as it now stands
type: SECURITY
priority: medium
complexity: medium
area: security
found: "2026-09-01"
---

# B22 — A security sweep of the code as it now stands

## Why

Four security findings are on the backlog — B01 (`X-Forwarded-For` taken on
trust), B02 (no security headers, inline SVG), B03 (`fetchImage` re-resolves
the hostname after checking it) and B04 (rate-limit state per-process, in memory). All four
come from one earlier pass, and the code has moved a long way since: owners and
guests, agent tokens, MCP over HTTP, media upload with quotas, encrypted
contact addresses, journal-level visibility.

Those are the parts most worth a fresh look, because they are where the
trust boundaries are and they are the newest:

- **The two credential types.** `resolveSession()` must keep Bearer tokens and
  guest cookies from being interchangeable — that is decision 24, and reading
  the site on a phone must not put a write credential in your pocket.
- **Username as a directory name.** `parseTripRef()`/`tripRef()` in
  `lib/trips.ts` are the security boundary for every content path; anything
  joining paths without them is a traversal candidate. `lib/media.ts` resolves
  reader-supplied `/media/...` paths.
- **Visibility, in both senses.** A trip's `visibility` gates who reads a
  journey; a journal's gates only whether it is advertised. An unrecognised
  trip value must read as `private`. Drafts must stay out of every reading
  path, the feed, the search index and the sitemap.
- **Contact addresses at rest.** `lib/contacts/crypto.ts` — AAD binding, key
  absence, and whether a decrypted address can reach a log or a response.
- **Media upload.** Size and per-day caps, the byte quota, and what happens
  with a file that is not what its extension claims.
- **MCP and REST write paths.** Everything an agent can reach must produce a
  draft; there is no flag anywhere that skips it, and that should be provable
  rather than believed.

The request was for an external model to do this, which is the right instinct:
a second reader who has not been living in these files is worth more here than
another pass by the one who wrote them.

## Work

1. Run `/security-review` over the working tree, and a `/code-review ultra`
   over the branch — both are user-triggered, so this task is a request to the
   author, not something an agent starts on its own.
2. Feed it the boundaries listed above explicitly. A sweep told only "find
   security bugs" re-finds the four already on the backlog and stops.
3. **Every finding becomes its own task in `backlog/`**, with the file and line
   and what it costs — one task per problem, per the rules in the skill. Do not
   fix anything in the same pass as finding it, and do not fold a new finding
   into B01–B04.
4. Anything the sweep raises that turns out not to be a problem still gets
   written down, with why. That is what stops the next sweep spending its
   budget on the same false positive.

Not doing: penetration testing a deployed host. This is a review of the source.

## Acceptance

- A review has been run against the current `main`, and its date and scope are
  recorded here.
- Each surviving finding has a backlog task with a `file:line` and a failure
  scenario.
- Each dismissed finding has a line saying why it is not one.
- `test/depersonalised.test.ts` and the existing access tests still pass — the
  sweep must not be the thing that breaks them.
