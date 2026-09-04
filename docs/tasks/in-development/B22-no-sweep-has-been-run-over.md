---
id: B22
title: No sweep has been run over the code as it now stands
type: SECURITY
priority: medium
complexity: medium
area: security
found: "2026-09-01"
started: "2026-09-04T07:49:29Z"
session: 2b6d1969-424a-4788-9497-eb5e151a5391
claimed: "2026-09-04T07:49:29Z"
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

## The sweep that was run

**2026-09-04**, against `main` at `ff81d59`, in the worktree
`g14-security-sweep`. Report: `docs/security/2026-09-04-sweep.md` — scope, what
held, what was dismissed and why, and what a source review could not reach.

Run as a read-and-reproduce pass rather than `/security-review`: the two
user-triggered commands in the Work section are the author's to start, and this
session was asked to do the review itself. Every boundary named above was
covered, plus the surface that landed the same morning (B02, B03, B04/B222,
B53, B182, B178/B204, B165/B183, B197).

Five findings, four with a reproduction that runs in the suite:

| | | |
| --- | --- | --- |
| B230 | high | A code issued for one trip is verified into a journal-wide token |
| B231 | high | A trip-scoped token downloads the whole journal from export.zip |
| B232 | medium | The reactions endpoint answers for a trip nobody may read |
| B233 | low | The https-only rule is not re-applied after a redirect |
| B234 | low | An unauthenticated health check discloses server paths and journal names |

`test/scope-escalation.test.ts` and `test/sweep-b22-disclosure.test.ts` hold the
reproductions. They **assert today's wrong behaviour and pass**, so the suite
stays green until each ticket lands and flips its expectations; each names its
ticket in the file.

Nothing was fixed here. Dismissed candidates are listed with their reasons in
the report, which is the half that stops the next sweep re-spending its budget
on them. Live probing of these findings belongs to B101 and was not started;
the report ends with the order to take them in.
