---
id: B112
title: Local scripts write straight to content, bypassing the token, draft status and rate limits every network write goes through
type: FEATURE
priority: medium
complexity: high
area: scripts, api, security
found: "2026-09-03"
---

# B112 — Local scripts write straight to content, bypassing the guarantees every network write goes through

## Why

Raised while fixing **B84**. The person's instruction: *"get rid of `npm run
ingest`, make sure all requests have to go through MCP/API — no direct local
access with functions like that."* B84 fixed the ingest bug but deliberately did
**not** remove the script, because doing so blind would delete a capability with
no replacement. This is where that decision gets made properly.

**Note (B298):** MCP was removed 2026-09-04 as unused overhead. The quote
above is the record of what was actually said and stays as written, but "the
network path" in this ticket now means the REST API alone.

The concern is real and larger than ingest. `AGENTS.md` describes "two doors,
the same content behind them": the network doors (`/api/v1`, `/api/mcp`) and the
in-repo skills that run `node`/`tsx` scripts against the files on disk. The two
doors do **not** enforce the same things. A write through `/api/v1` carries a
token (`resolveSession`), lands as `status: draft` with no flag able to skip it
(the one rule in AGENTS.md), is rate-limited, and cannot publish without a
separate owner-only call. A local script writes to `content/<user>/` with none
of that — no token, no forced draft, no rate limit, no publish gate. `ingest`
writes entries directly; `postcard` and `photobook` build provider requests
locally; `migrate:*` rewrite user data.

For an operator on their own box that is fine — they have shell access anyway,
which is the whole trust model of a self-hosted tool. The question the person is
raising is whether that second door should exist at all, or whether everything —
including an agent working *in the repo* — should be made to go through the
authenticated path so there is exactly one set of guarantees to reason about.
That is decision 24's spirit ("reading on your phone must not put a write
credential in your pocket") extended: *no* write should exist that skips the
draft/publish/token rules, not even a local one.

This is a genuine architectural fork, not a bug, and it collides with two things
that have to be resolved rather than assumed:

**Ingest is offline by design.** `scripts/ingest.ts`'s header is explicit:
*"Everything it needs is on the disk. There is no network call anywhere in this
path, including the reverse geocoding, because the evening you most want to write
up the day is the evening the wifi does not work."* The 2,457 lines under
`lib/ingest/` cluster a folder of camera files into days by EXIF time and GPS,
geocode against a local place index, and transcode derivatives. An agent hitting
a hosted instance over the network cannot point at the operator's SD card, and
the API's `add_media` only attaches already-decided bytes to an
already-created, already-dated day. Routing ingest "through the API" means
either uploading the whole folder for the server to process (losing offline, and
a large new endpoint) or moving the smart part client-side and calling the API
per day. Neither is free.

**`content/` is the source of truth an operator is meant to own.** The premise
of the whole project is a folder the author can edit, back up and drop in.
Forbidding local writes entirely is in tension with that. The likely honest
answer is not "no local access ever" but "no local write path that bypasses the
draft rule": a local script may write, but only as a draft, through the same
validation `lib/tripWrite.ts` and the API use — so the guarantee holds on both
doors.

## Work

This needs a written decision before any code — put it in `docs/plans/` and
point this task at it (B06 is the precedent). The plan has to choose, with the
reasoning, between at least:

- **Keep both doors, unify the guarantee.** Local scripts stay, but every local
  write goes through one validated writer that forces `status: draft` and the
  same field validation the API applies, so nothing — local or network — can
  write a published day or an invalid one. Ingest stays offline. Smallest change
  to how the project works; closes the guarantee gap without closing the door.
- **Close the repo door.** Remove the write scripts (`ingest`, `postcard`,
  `photobook`, …), expose their capability through the API, and make the
  in-repo skills call the network path like a remote agent would. Honours the
  instruction literally; costs offline ingest and is a large build. Decide what
  replaces folder-clustering ingest, and whether the operator loses the ability
  to work with no server running.
- **Split by kind.** Content writes (ingest, publish) go through the
  authenticated path; local-only build tooling that never touches user content
  (`build:mapdata`, `build:geodata`, `update-rates`, `tasks`) stays as scripts,
  because forcing a token onto a map-data build guards nothing.

Whichever is chosen, name explicitly what happens to: offline ingest, the
`migrate:*` one-off operator scripts, and `content/` as an operator-editable
folder. The instruction that motivates this is about *write* paths and the
guarantees they skip — read scripts and build tooling are not the target and
should not be swept up by accident.

Not in scope here: implementing the chosen option. This task is the decision and
its plan; the build is a follow-up once the direction is set, because each
option is a different size and touches different skills.

Related: **B84** (the ingest fix that surfaced this), decision 24 and the "one
rule" in `AGENTS.md`, **B89** (credits — another money-spending path that must
sit behind the authenticated door).

## Acceptance

- A plan in `docs/plans/` that picks a direction and says why, answering the
  offline-ingest, `migrate:*` and operator-editable-`content/` questions rather
  than leaving them implied.
- This task references that plan; the plan is not edited afterwards to match what
  shipped (it is the record of intent).
- A follow-up task opened for the build, scoped to the chosen option.
