---
id: B223
title: The draft rule is stated three different ways since the publish endpoint shipped
type: DOCS
priority: high
complexity: medium
area: docs, api, mcp, i18n
found: "2026-09-04T07:30:42Z"
started: "2026-09-04T07:32:24Z"
merged: "2026-09-04T07:56:56Z"
---

# B223 — The draft rule is stated three different ways since the publish endpoint shipped

## Why

B28 shipped `POST .../days/<slug>/publish` and `publish_day` on 2026-09-01
(`95f41f5`), and B156 followed it through part of the MCP door. What neither
touched is everything else that states the rule. The result is a repository
that answers "can an agent publish?" differently depending on which file you
open.

**Three statements are now false, not merely dated:**

- `README.md:19` — "A person removes one line from one file to publish it.
  There is no parameter, flag or **endpoint** anywhere that skips that step."
  `AGENTS.md:29` was narrowed to "on anything that *writes*" when B28 landed;
  the README never was, and it is the first thing anybody reads.
- `lib/api/entries.ts:24` — "a human moves an entry from draft to published,
  and **the API has no way to skip the step**". `publishDraft()` is 350 lines
  below it in the same file.
- `components/DraftNotice.tsx:12,19` and `draft.body` in `en`, `de` and `hu` —
  the banner an owner meets in their own browser says to delete the
  `status: draft` line from the file. That is precisely the wall B28 was filed
  to remove: it sends somebody who has never seen the folder to a text editor.

**Two more disagree with the network door rather than with fact:**
`.claude/skills/add-a-day/SKILL.md:95` ("Do not offer to publish it") and
`.claude/skills/ingest-photos/SKILL.md:100` ("publishing is their step, not
yours"), while `/agent.md` and `list_drafts` tell the network-side agent to ask
which drafts to publish. Same product, two doors, opposite instructions.

**And several are true but framed against where the product is going:**
`welcome.draftsRule` in all three locales sits one paragraph after
`welcome.drafts` and contradicts its tone; `/documentation.txt`
(`lib/api/documentation.ts:99`) is the first document an agent reads and never
mentions the publish call; `app/openapi.json/route.ts:36` the same; a draft's
body over MCP (`lib/mcp/tools.ts:304`) says "A person publishes it" with no
`publish_day`; `lib/entries.ts:215` and `docs/ROADMAP.md:254` still say "only a
person publishes them".

The cost is that an agent reading this repository cannot tell what it is
allowed to do, and takes the most restrictive reading — which is what the
second agent run recorded in B28: it finished the work and had to end its
report with a shrug.

**The decision has been taken and it is not the one B28 assumed.** The author's
answer, 2026-09-04: *the agent is the editor, full stop.* Drafts exist so a
person can read something back before it goes up, not as a gate. That is a
change to the doctrine itself, not a documentation tidy, which is why this task
rewrites rather than patches.

## Work

Restate the rule once, in the same words everywhere:

> There is no editing interface. The agent is the editor: it writes, it
> publishes, it corrects. Drafts exist so you can read something back before it
> goes up — not as a gate.

Then carry it through, in this order so the canonical wording exists before
anything cites it:

1. `README.md` and `AGENTS.md` — the blockquote and "The one rule".
2. `lib/api/documentation.ts` — `/documentation.txt` gains the publish call it
   omits; `/agent.md`'s "The one rule" and "Publishing, when they say so" drop
   the reserved-for-a-person framing and keep **"ask, in words, and wait"**,
   which is unaffected by this change.
3. `app/openapi.json/route.ts:36`, `lib/mcp/tools.ts:304,406,849,1356`,
   `app/api/v1/[user]/trips/[trip]/days/route.ts:148`.
4. `components/DraftNotice.tsx` and `draft.body` in `en`/`de`/`hu` — the banner
   says *tell your agent to publish it*, and names no file.
5. `welcome.draftsRule` in `en`/`de`/`hu` — stop saying "nothing an agent
   writes can publish itself" three paragraphs from "tell your agent to publish
   it".
6. Doc comments: `lib/entries.ts:215`, `lib/api/entries.ts:24`.
7. `docs/ROADMAP.md` — G7's paragraph, **and a new decision-log row** recording
   that publishing moved from a person's file edit to an agent call. Decision 24
   covers "no editing UI" and nothing records this.
8. `docs/TESTING.md` G12 and `docs/qa/SCENARIOS.md` C2 — walk the endpoint, not
   only the file edit.

**Two things this deliberately does not do.**

`POST .../days` stays draft-only — no `status` parameter, no publish-on-create.
That is what keeps "read it back before it goes up" true, and it is the whole
of what remains structural.

The two repo skills stay stricter than the network door, by the author's
decision: on disk the person has the folder, so the file edit is a real option
and the skill leaves it to them. Rewrite the bare prohibition to **say that**,
so the next reader does not mistake a deliberate split for the old doctrine
surviving by accident.

Dropping the confirmation round trip on `publish` is B224, not this.

## Acceptance

- `grep -rn "no parameter, flag or endpoint" README.md` returns nothing.
- `grep -n "the API has no" lib/api/entries.ts` returns nothing.
- `grep -rn "status: draft" content/locales/*.json` returns nothing — the
  banner no longer names a line to delete.
- `/documentation.txt` and `/agent.md` both name the publish call; a test in
  `test/agent-interface.test.ts` asserts the first one does.
- `docs/ROADMAP.md` has a decision row for publishing over the API, citing B28.
- The two repo skills state why they are stricter than the network door.
- All four checks pass: `npm run build`, `npx tsc --noEmit`, `npx eslint .`,
  `npx vitest run`.
