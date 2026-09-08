---
id: B976
title: Nothing about a conversation survives it, so nobody can tell what to improve
type: FEATURE
priority: high
complexity: high
area: helper, admin, privacy
found: "2026-09-08T16:06:41Z"
started: "2026-09-08T16:06:49Z"
merged: "2026-09-08T16:46:11Z"
---

# B976 — Nothing about a conversation survives it, so nobody can tell what to improve

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

The owner asked to collect chat sessions so that, as operator, they can analyse
and improve them. Today nothing is kept.

`lib/helper/thread.ts` holds a conversation in process memory — twelve turns, a
thirty-minute TTL, dropped on every deploy. Thirty-four deploys on 2026-09-08
each wiped every conversation on the instance. The decision is written into the
file and was right at the time: *"what a person typed at their journal on a
Tuesday would then sit in a backup, in a restore drill and in an export, and
nobody asked for it to be kept."* Somebody has now asked.

What is stored is `usage` — owner, provider, model, operation, tokens,
seconds. It says what a turn **cost** and nothing about what happened in it.

**The gap that actually hurts is not transcripts.** The honesty net has ten
guards, and what records whether they fire is three integers —
`{turns, claimed, unrecovered}` — process-global, not per-guard, not
per-journal, reset on every restart. So on the day the net was built, the only
instrument for "did that fix work" was driving the live site and reading the
answers back by hand. **Every fault found that day was found by a persona test,
because there is no data.**

## What was decided

Asked, with the trade-offs laid out:

- **Telemetry for everybody, transcripts only where the owner opted in.**
- **Kept indefinitely** — the alternative offered was a ninety-day sweep for
  anything containing words, and indefinite was chosen.
- **An opt-out on `/<user>/me`.**
- **A line on the first message of a conversation** saying it is recorded for
  improving the helper and nothing else.
- **A statement in the imprint** (`site/legal/<code>.md`).

One fact makes opt-in sufficient rather than a fig leaf: **the helper is
owner-only.** Every `/api/helper/**` route gates on `isHelperOwner`, so a
transcript contains the words of the person who consented and nobody else. No
guest, no buddy, no reader ever talks to it.

## Work

**A table, and one module.** `lib/helper/sessions.ts` records two kinds of row
and, like `recordUsage`, **never throws**: a person has already been given
their answer by the time it runs, and losing the answer to an analytics insert
would be trading the product for the bookkeeping.

- **A turn**, from `POST .../ask`: the journal, a session id, when, the
  locale, which tools ran, which proposals were made, which guard fired and
  whether the retry recovered, how many turns the thread held. Prose only where
  consent says so.
- **A press**, from the write routes — `wrote()` in `lib/helper/thread.ts`
  already sits at exactly the right place (B939). Which tool, and whether the
  route accepted it.

The pair is what makes the data worth having: a proposal made and never pressed
is the product's clearest failure signal, and today nothing counts it.

**A session id.** The thread is keyed by journal alone; grouping turns into a
conversation needs one. It is minted when a thread starts and dropped with it,
so it lives exactly as long as the conversation does.

**Consent.** A fifth `HelperScope`, `sessions`. The existing four record *who
the data goes to*; this one goes nowhere — it stays on the instance — so the
provider is this site itself, and the panel has to say that rather than
implying a third party.

**The three places a person meets it**: the first turn of a conversation says
what is recorded and links to the control; `/<user>/me`'s owner block gets a
fourth concern-card beside the agent, the money and the people; the imprint
carries the standing statement in both languages.

**Reading it** is `/admin`, which is already the operator's one page and
already reads `usage`.

Not doing: any of it for guests, who cannot reach the helper. No sweep, per the
decision above. No export of sessions — a journal's own export is its content,
and this is not content.

## What must be true whatever else changes

**Deleting a journal takes its sessions with it.** `lib/deletions.ts` is the
path, and a deleted journal that leaves its conversations behind is not a
retention policy, it is a bug.

## Acceptance

A conversation on a journal that has not consented leaves rows saying what
happened and no words. The same journal, having consented, leaves the words
too. `/admin` shows, per journal and per tool, how many proposals were made and
how many were pressed, and which guards fired. Turning it off at `/me` stops
new words being kept. Deleting the journal removes every row.

## The decision changed once the history was asked for

A later instruction: the person should be able to **go back to an older chat
session**, with a parameter in the URL so that copying it returns them to that
conversation.

That makes storing a conversation the *feature* rather than the analytics, and
it moves what consent is for:

- **The words are kept because they are the person's own history**, not because
  anybody wants to study them. A conversation you can return to is a
  conversation that was saved.
- **Consent governs whether the operator may read them.** That is what the
  control on `/me` turns off, and what the notice on the first message has to
  say — precisely, because "turning this off deletes nothing" is the true
  sentence and a person who assumed otherwise would be misled by silence.

So the schema is unchanged and the meaning of one column is not: `said` and
`answered` are written for every journal, and the operator's own reading of
them is gated. The notice and the `/me` card both say which of the two they
are about.

Nothing here weakens the earlier point that made opt-in workable: the helper is
owner-only, so a stored conversation holds the words of one person, and that
person is the one who can read it back.
