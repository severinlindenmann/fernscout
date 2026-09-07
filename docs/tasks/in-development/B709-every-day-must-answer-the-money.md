---
id: B709
title: Every day must answer the money question before it is written
type: ISSUE
priority: low
complexity: medium
area: entries, tracks
found: "2026-09-07T11:17:11Z"
started: "2026-09-07T11:40:35Z"
session: 97b44327-dee7-4b48-bf97-305a0b3d1f54
claimed: "2026-09-07T11:40:35Z"
---

# B709 — Every day must answer the money question before it is written

## Why

`lib/tracks.ts:126` — `TRACK_ROWS.costs.when` is `"write"`, so a trip that
tracks costs demands an answer about money at the moment a day is created. The
wizard (B682) meets this on its first screen, before the person has chosen a
photograph, and an agent meets it before it has been told anything about the
day.

The honest answer at that moment is almost always "nobody has it yet", and a
question asked too early is answered wrongly and rarely revisited — which
quietly fills the journal with `costs: unknown` on days that did have costs.

Whether costs belong at write or at publish is a product decision, not a bug,
which is why this is a ticket and not a fix. B554 is adjacent but is about the
third answer rather than about when the question is asked.

Found while building B682, and seen again in the browser: the first screen of
the wizard asks about money before it asks about anything else.

## Work

Decide whether `costs` moves to `when: "publish"`. If it does, check every
writer that currently satisfies it at write time. If it does not, write down in
`lib/tracks.ts` why, so the next person does not re-open it.

## Acceptance

Either the question is asked at publish, or the file says why it is asked at
write.

## Triage

This is a design question, not a bug fix, exactly as the ticket already says
— so nothing was built. Confirmed against current code:

- `lib/tracks.ts:127` — `TRACK_ROWS.costs.when` is `"write"`.
- `lib/tracks.ts:230-234` — `missingFrom(facts, tracks, when)` already
  supports mixed timing: at `when: "write"` it filters to rows whose own
  `when` is `"write"`; at `when: "publish"` every tracked row is checked,
  `costs` and `coordinates` included. `photos` is already `when: "publish"`,
  for the reason given at `lib/tracks.ts:81-84` (media is a separate call, so
  a day has none to report yet at write time).
- Callers that would need re-checking if `costs` moved: both
  `app/api/v1/[user]/trips/[trip]/days/route.ts` (write) and
  `.../days/[slug]/publish/route.ts` (publish) call `missingFrom` already
  gated by `when`, as do the two helper-route mirrors
  (`app/api/helper/[user]/day/route.ts`,
  `app/api/helper/[user]/day/publish/route.ts`). **The mechanism needs no
  change** — moving `costs` is changing one string in `TRACK_ROWS`. The
  decision is entirely about product behaviour, not implementation cost.

**What moving it would change**, concretely:

- A trip that tracks costs would let `POST .../days` succeed with nothing
  said about money, and would refuse `.../publish` instead if the day still
  says nothing. The wizard's first screen (money) would no longer block
  choosing a photograph or writing prose; the same question would appear on
  the preview/publish step instead, by which point an agent or a person
  answering the helper often does have a number, or would at least be asked
  once at a moment when "unknown" is a more honest answer than a shrug typed
  to get past a blocking screen.
- A day that is *never* published (a private note, or written and abandoned)
  would never be asked at all under `publish`, whereas today it is asked
  immediately under `write`. Whether that is a feature (nobody nags an
  unfinished day) or a hole (a day can sit forever with the question
  unanswered, and `npm run tasks`-style "what does this trip still owe"
  reporting — if it existed — would have nothing to flag) is itself a design
  question this triage does not resolve.
- `coordinates` has the identical shape of problem — it is also `"write"` —
  and the ticket only names `costs`, so a decision here likely wants to ask
  the same question about `coordinates` rather than leave the two rows
  disagreeing for no stated reason.

### Options

1. **Move `costs` (and arguably `coordinates`) to `when: "publish"`.**
   Matches how `photos` already works, and fits the ticket's own diagnosis:
   the honest answer at creation time is usually "nobody has it yet," and a
   forced answer this early is answered wrong and rarely revisited. Risk: a
   day that never gets published never gets asked, so the journal could
   accumulate finished-looking drafts with unanswered money questions
   indefinitely — today that is impossible, because write already forces the
   answer.
2. **Leave it at `when: "write"`, and say why in `lib/tracks.ts`.** The
   honest case for the status quo: asking early means the answer is captured
   while the day is fresh in memory rather than left for a "finish it later"
   that may never come, and it treats `unknown` as a legitimate, cheap answer
   rather than a failure state — the module's own `NOT_KNOWN` text already
   argues that "I don't know yet" is a normal, honest thing to write down.
   The wizard's UX problem (asking before a photograph is chosen) could then
   be solved on the wizard's side — reorder its own steps, or make the
   missing-tracks panel less prominent on the first screen — without touching
   the trip-wide contract at all.
3. **Split the difference: ask at write, but let the wizard defer its own
   prompt to a later step without changing the API contract.** The `POST
   .../days` call already tolerates `costs: "unknown"`, so a human-driven
   wizard could quietly send `"unknown"` on create and surface a real
   "did you spend anything this day?" prompt on the preview step, upgrading
   the day's own `costs` field via a day-edit call if the person answers with
   real numbers before publishing. This keeps the write-time contract
   (nothing silently omits money) while fixing the wizard's specific
   UX complaint. It does not fix an agent's own experience of being asked too
   soon, if that is considered a live problem for the network-facing API
   guide as well as the wizard.

### Recommendation

**Option 1** for `costs`, leaving `coordinates` as `write` for now.
Coordinates come off a photograph's EXIF or a plan the trip already has, so a
person or agent typically *does* know them (or knows firmly that they don't)
at write time, in a way that is not true of money, which is often settled
days later. Moving `costs` alone is the one-line change described above (plus
updating `AGENTS.md`/`agent.md`'s field documentation and `/openapi.json`'s
example flow if either currently implies costs is asked at creation), and it
directly answers the complaint this ticket raised. But this is exactly the
kind of call AGENTS.md reserves for a person: it changes what an agent is
told it must answer and when, on every trip that tracks money, and the
consequence noted above (an unpublished day can go on forever without the
question ever being asked) is a real trade a person should sign off on
rather than infer from a ticket titled after the symptom.

No code changed for this ticket.
