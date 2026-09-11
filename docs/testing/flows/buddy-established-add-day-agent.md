# Flow: buddy-established-add-day-agent

**Persona:** `buddy-established` (docs/testing/personas/buddy-established.md)
**Interface:** `/agent`
**Capabilities exercised:** `helper`, `auth`
**Device/locale:** run at both desktop and mobile viewports when a ticket
asks for both; language matches whichever locale the seeded journal uses.
**Check type:** technical (correct API calls, correct draft, correct trip
scoping) and graphical (the `/agent` conversation UI itself, at the
requested viewport).

## Setup

1. Local dev server running with `features.helper` on and
   `ANTHROPIC_API_KEY` set — this flow makes a real (small) Anthropic call,
   per the accepted cost in the design's Global Constraints.
2. A `test-buddy-established` journal seeded with one trip and a
   trip-scoped agent token for the buddy persona (`get-token.sh` against the
   local server, scoped to that trip).

## Steps

1. Drive `http://localhost:3013/agent` (not the live site — unlike
   `.claude/skills/test-with-personas/SKILL.md`, which points at
   `https://fernscout.ch/agent` on purpose; this flow needs the local
   dry-run/test-key environment) as the `buddy-established` persona: ask it
   to add a day for "the pass we crossed today", describing only what the
   persona actually said happened.
2. Confirm the agent writes the day as a draft (`POST .../days`, never
   published on create — AGENTS.md) and scoped to the one trip the buddy
   token covers.
3. Ask the agent to publish. Confirm it refuses or defers — a buddy token
   cannot publish (AGENTS.md: "being on the bus is not the same as deciding
   what the journal says").
4. Screenshot the `/agent` conversation at the requested viewport(s).

## Done when

- The draft day exists, scoped to the right trip, containing only what the
  persona said (technical check).
- The agent never calls the publish endpoint on the buddy's behalf, and its
  own words to the persona do not claim the day is published (technical +
  the "claim checked against the turn" rule in AGENTS.md's `lib/helper/model.ts`
  section).
- The conversation reads correctly at each requested viewport (graphical
  check).
