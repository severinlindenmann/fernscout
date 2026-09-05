---
id: B301
title: The handover block still offers the read-out-a-code route beside the key, which is two ways to do one thing
type: ISSUE
priority: medium
complexity: low
area: me-page, agents
found: "2026-09-04T14:22:00Z"
started: "2026-09-04T14:16:23Z"
merged: "2026-09-04T14:39:48Z"
session: 62683d95-33a6-4db0-a254-7a8fcbcf014e
claimed: "2026-09-05T09:14:26Z"
---

# B301 — The handover block still offers the read-out-a-code route beside the key, which is two ways to do one thing

## Why

Asked by the owner on 2026-09-04, looking at the block B283 had just shipped.

B283 added the button that mints a twenty-minute key and prints a pasteable
prompt, and **kept the old route visible underneath it**:

> Oder gib stattdessen diese zwei Zeilen weiter und lies den Code vor, nach dem
> er fragt:
> `https://fernscout.ch/documentation.txt`
> `viki@severin.io`
> [Link kopieren]

That was a deliberate choice in B283 and it was the wrong one. The reasoning
was "nothing about the code flow was removed, so offer it" — but the page this
sits on is written for the reader least comfortable with software here, and the
one thing that page must not do is present two ways to do the same job and
leave the choice to somebody who has no basis for making it. Four lines and a
second copy button, under a heading that already has a copy button, is the
shape of an interface that has stopped deciding on the reader's behalf.

The code flow itself is **not** going anywhere: `POST /api/auth/request` and
`/verify` are unchanged, `/agent.md` documents them as the main path, and an
agent that cannot make an HTTP call of its own still uses them. What goes is
its second billing on this page.

## Work

Remove the `me.agentByHand` paragraph, the two `<p className="font-mono">`
lines and the `CopyLine` under them from `components/AgentHandover.tsx`. What
remains is the heading, the sentence, and the button.

Then:

- **`me.agentByHand`, `me.agentCopy` and `landing.copy`/`landing.copied` at
  that call site become dead** — check each against the rest of the codebase
  before deleting, since `landing.*` are the landing page's own and stay.
- **`docUrl` and `email` become unused props** on `AgentHandover` if nothing
  else renders them. If so, remove them and simplify both call sites
  (`app/[user]/me/MePageContent.tsx`, `app/[user]/trips/TripsIndexContent.tsx`)
  and `EmptyJournal` with them — `npm run unused` will not catch a prop nobody
  reads.
- **`test/copy-line-name.test.tsx` asserts on exactly this block** (B199: the
  accessible name for a two-value copy control). Those assertions are about a
  control that will no longer exist. Move what still applies to the prompt's
  own copy button, which has the same problem for a stronger reason — it copies
  a live credential — and delete what does not.

Not doing: removing the code flow, or changing `/agent.md`, which documents it
as the way in for an agent nobody pasted a key into.

## Acceptance

- `/<user>/me` and the empty trip list show the handover heading, its sentence
  and one button, and nothing about reading out a code.
- Signing in with a code still works end to end, and `/agent.md` still
  describes it.
- No orphaned translation keys and no unused props left behind; `npm run unused`
  clean.
- The B199 assertion about not reciting a copied value survives, pointed at the
  prompt's copy button.
- The four checks pass.

## Verified

All four green: `npm run build` compiled, `npx tsc --noEmit` clean, `npx eslint .`
0 errors (4 pre-existing warnings, none in these files), `npx vitest run` 161
files / 2457 tests. `npm run unused` exits clean — no unused files, dependencies
or unresolved imports (only the pre-existing, non-failing "unused exports" list
B235 owns).

### What was built

- `components/AgentHandover.tsx`: removed the `me.agentByHand` paragraph, the
  two `font-mono` lines and their `CopyLine`, and the `docUrl`/`email` props
  that fed them. The `prompt !== null` branch was split into an exported
  `HandoverPrompt({ prompt, expires })` — not asked for in Work, but needed to
  make the B199 assertions renderable at all: this repo's tests use
  `renderToStaticMarkup` with no simulated clicks, and the old two-line block
  was the only part of this component reachable that way. Without the split
  there was no way to exercise the prompt's copy button in a test.
- `docUrl`/`email` removed as props, all the way up: `MePageContent.tsx`,
  `app/[user]/me/page.tsx`, `TripsIndexContent.tsx`'s `EmptyJournal` type and
  its `EmptyState`, and `app/[user]/trips/page.tsx`'s construction of `empty`.
- Dead keys removed from `lib/i18n.ts` (via `npm run i18n:keys`, not by hand)
  and all three `content/locales/*.json`: `me.agentByHand`, `me.agentCopy`,
  `landing.copy`. `landing.copied` stays — the prompt's own copy button uses it
  too.

### One thing found beyond the Work list, and fixed rather than captured

Three other translation strings said "hand the two lines below" in some form —
`me.agentBody` (the sentence right under the heading), `trips.emptyOwnerBody`
(the empty-trip-list page), and `me.ownerNoTrips` (the "nothing here yet" line
on `/<user>/me`). None were named in Work, but all three became literally false
the moment the two lines were deleted, and `me.ownerNoTrips` is what an
existing test (`access-panel.test.tsx`) actually failed on first — proof this
wasn't a nearby unrelated finding but breakage the deletion itself caused. Fixed
in all three locales rather than filed as a new backlog item, since leaving
stale copy pointing at a removed control would fail the first acceptance line
("nothing about reading out a code... shows the handover heading, its sentence
and one button") in substance even where the literal grep passed.

### B199 test, moved rather than dropped

`test/copy-line-name.test.tsx` no longer renders `AgentHandover` at all — moved
to render `HandoverPrompt` directly with a synthetic multi-line prompt. All
three assertions moved (name recites what pressing it does rather than the
value; no accessible name carries a newline; the name is translated in all
three locales), retargeted from `me.agentCopy` to `me.handoverCopy` since that
is the key the surviving control already used. Nothing was dropped — the old
control they were about no longer exists, and the new control has the same
shape of risk for a stronger reason (a live credential, not two public
addresses). The unrelated "single value" describe block (B79) was left
untouched.
