# The studio: every owner action as a flow

*Written 17 September 2026, before the work. The record of intent, not of what
shipped.*

A styled version sits beside it as `2026-09-17-the-studio.html`.

This plan **revises** `2026-09-16-whatsapp-day-funnel.md` and
`2026-09-16-capability-split.md`, written the day before. Those two assumed
WhatsApp owns day creation and the browser mops up. That is now the wrong way
round. The funnel still gets built; it is no longer the primary path.

## Three ways in

Fernscout has three front doors, and each one is complete on its own terms.
This is the shape the rest of the plan serves.

| | For | Reaches |
| --- | --- | --- |
| **The studio** — `/[user]/studio` | Anybody. No agent, no terminal, no API key | **Everything.** Every action is a guided flow |
| **Your own agent** — the API, the schemas, the helper repository | People who already work with an agent and would rather it did the typing | **Everything.** Whatever the studio can do, a caller can do |
| **WhatsApp** | The evening in a tent | **The daily entry.** Photographs, a voice note, publish. Everything else redirects into a studio flow |

Two things follow from that table, and both are load-bearing.

**The API is not a convenience, it is a front door.** "Bring your own agent"
only means anything if the v2 contract genuinely covers what the studio covers.
Every studio flow that reaches a capability the API cannot reach is a broken
promise, and `keep-the-contract` is the check. A flow and an endpoint are two
faces of one capability.

**The hosted `/agent` is not one of the three.** It was an attempt at doors one
and two at once and does neither well. Door one becomes the studio; door two
becomes the person's own agent, pointed at the API and the helper repository.
`/agent` stays for the moment and retires into those two — see below.

## The decision

**Everything a person can do to their journal becomes a flow they pick from one
place.** That place is `/[user]/studio`.

A flow is a short guided sequence with a beginning, visible steps, a preview,
and one final button named after what it does. Adding a day is a flow. So is
editing one, making a trip, inviting somebody, bringing in a bank statement,
ordering a postcard.

Three consequences, stated plainly because each reverses something:

1. **The browser is primary.** A person can create and manage all of their
   content without ever talking to an agent.
2. **WhatsApp is the shortcut**, not the front door. It is for the evening in a
   tent: today's photographs and a voice note. Everything else it redirects into
   a studio flow.
3. **`/agent` is on a retirement path.** It stays for now, because the long tail
   is long and some things are genuinely easier said than clicked. Every flow
   that ships removes a tool from it. It is not a permanent second front door.

The import hub is **absorbed**: bringing something in is a flow like any other,
and `/[user]/extract` becomes `/[user]/studio` rather than `/[user]/import`.

## Why the previous plan was wrong about this

Yesterday's reasoning was that a model in a chat could carry the daily entry and
pages would handle the rest. The narrowing was right; the split was not.

The failure it was reacting to — B1803's "the plan specified behaviour and never
specified experience" — is not caused by *where* the work happens. It is caused
by nobody owning the sequence a person moves through. A chat with forty tools
and a page with a bare file picker fail the same way: they present capability
instead of a path.

A flow is the unit that fixes both. The five-step import shape in
`2026-09-16-import-onboarding.md` — why → get it → deliver it → peek → decide —
was already a general answer wearing an import costume.

## The flow skeleton

Generalised from the import shape. Not every flow needs all five; every flow
uses these in this order, skipping what does not apply.

1. **Why / what this is** — one sentence on what you get, and any promise that
   needs making at the moment of asking rather than in a footer.
2. **Gather** — the questions or the file. One thing per screen. Platform tabs
   and screenshots where a person has to go and fetch something.
3. **Preview** — what will happen, in real numbers and real content. Stated
   explicitly: nothing has been written yet.
4. **Decide** — the check-answers screen. Every row changeable, every choice
   visible.
5. **Do it** — one button, named after its consequence. Never "Next", never
   "Continue", never "Save". Then a done screen saying what changed and offering
   the obvious next flow.

Rules that hold across every flow:

- **Nothing is written before step 5.** A person can back out at any point and
  the journal is untouched.
- **A flow can be left and resumed.** `ResumeScreen` already does this for
  photographs; it becomes part of the skeleton.
- **Steps are self-sufficient** — no step needs information from elsewhere in
  the app. This is the rule that deletes the documentation (B1826).
- **Publishing is always its own decision**, never a side effect of a flow.
- **Confirmations use `components/ConfirmPanel.tsx`**, never `window.confirm`.

## The hub

`/[user]/studio` lists the flows, grouped by what a person is trying to do, with
the main one first and largest.

```
Write
  Add a day                     ← the main flow
  Edit a day
  Move, split or merge days

Plan
  New trip
  Trip settings and who may read it

People
  Invite somebody to read
  Add the people who were there

Bring in
  Photographs
  Location history
  Contacts
  A bank statement

Print
  A postcard
  A photobook
```

The hub is also where an empty journal starts. A person with no trips sees one
call to action, not a grid of fourteen things they cannot do yet.

Flows a person cannot currently run — because a capability is off, or because
there is no trip to add a day to — are shown with the reason, not hidden.
Hiding them is how a person concludes the software cannot do something it can.

## What exists today

The point of this table is that the studio is substantially an **arrangement**
job, not fourteen features.

| Flow | Today |
| --- | --- |
| Add a day | **Does not exist in the browser.** Only through an agent |
| Edit a day | Exists as `components/EditDay.tsx`, a panel reached from `OwnerTools` on the day page — findable only if you are already looking at the day |
| Correct or take down a published day | Exists, in `OwnerTools` |
| Move, split, merge days | **Does not exist.** Agent only |
| New trip | **Does not exist.** Agent only — B1821 |
| Trip settings, visibility | Partly, on the trip page |
| Invite somebody | Exists at `/[user]/contacts` (`ContactsAdmin`) as a page, not a flow |
| Add the people who were there | **Stub** — B1823 |
| Photographs | Full flow already (`ExtractFlow.tsx`) — the model for the skeleton |
| Location history | Writes, no preview or decide step — and B1819 blocks it |
| Bank statement | Reads, never writes — B1822 |
| Postcard, photobook | Exist as their own pages |

So: two genuine gaps (add a day, move/split/merge), two stubs already ticketed,
and a lot of existing work that needs a front door and a common shape.

## What this changes in yesterday's tickets

- **B1820** (the WhatsApp funnel) keeps its design but loses its primacy. The
  funnel is the travelling shortcut. Its redirects now point into studio flows.
  A revision note goes on the ticket and on its plan.
- **B1821** (create a trip) becomes the *New trip* flow, inside the studio.
- **B1822**, **B1823** (costs, contacts) become *Bring in* flows.
- **B1824** (the five-step onboarding) is where the **flow skeleton** is built.
  Its shape is no longer import-specific; the studio hub consumes it. These two
  tickets are tightly coupled and should probably be taken together.
- **B1825** changes target: `/extract` → **`/studio`**, not `/import`. The
  collision with B1803 has cleared — B1803 merged on 17 September.
- **B1826** (delete the docs) is unchanged and still must not land before the
  flows carry the guidance.

## `/agent`'s retirement, and where the agent story goes instead

`/agent` is not one of the three doors. It tried to be the UI and the agent at
once: a chat that does the work itself, hosted by us, paid for in our credits,
against a model we chose. The person who wants an agent mostly already has one.

So it retires into the other two, and neither of them is a loss of capability:

- What it does that is really **an action** becomes a studio flow.
- What it does that is really **an agent** becomes the person's own agent,
  pointed at the v2 API with the schemas and the helper repository as its
  instructions.

The path, with no date on it — the test is the size of what is left, not a
calendar:

1. Every flow that ships prunes the matching tool from the areas `/agent`
   offers. A capability with a flow does not keep a parallel chat path.
2. In parallel, `keep-the-contract` proves the API reaches everything the flow
   reaches. A pruned tool that leaves no API equivalent is a capability lost,
   not moved.
3. What remains is the genuinely conversational residue — a money interview, an
   odd one-off. When that is small enough to answer with "which flow did you
   want?", `/agent` is a router rather than a worker, and can go.

This makes `docs/helper.md` (B1826) more important, not less: it is door two's
front page. It should say plainly that an agent reaches everything through the
API, what the helper repository gives you, and how to point your own agent at
it — rather than promising a hosted chat forever.

## Sequencing

1. **The skeleton and the hub** — the flow component, resume, the preview and
   decide steps, and `/studio` listing them. Built with B1824, since that ticket
   is where the skeleton lands. Nothing else can be a flow until this exists.
2. **Add a day** — the main flow, and the first real proof the skeleton works
   for something that is not a file upload.
3. **The existing work, rehoused** — edit a day, new trip (B1821), invite,
   imports (B1822, B1823) wear the skeleton and appear in the hub.
4. **Move, split, merge days** — the remaining genuine gap.
5. **The rename** (B1825) lands whenever is convenient after the hub exists,
   since it now points at `/studio`.
6. **The WhatsApp funnel** (B1820) follows, because its redirects need flows to
   redirect into.

## Open questions

- Does the studio replace the owner controls on the day page, or sit alongside
  them? A person looking at a day should probably still be able to fix it there
  — the studio is the front door, not the only door.
- Does a flow get a URL of its own that can be linked to and resumed from
  WhatsApp? Almost certainly yes, and that is how the funnel's redirects should
  work — deep into a flow, not at the hub.
- How much of `OwnerTools` survives once flows exist?
- Hungarian, for every new string, as ever. Not written, must not be invented.
