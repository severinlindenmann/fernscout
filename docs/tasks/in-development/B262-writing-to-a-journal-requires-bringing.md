---
id: B262
title: Every document still promises there will never be an editing interface, while one is being built
type: DOCS
priority: high
complexity: low
area: docs, roadmap, agent guide
found: "2026-09-04T11:16:59Z"
started: "2026-09-07T11:27:36Z"
session: ccdd5120-0eb0-4abf-b76e-a6fd8e5005d8
claimed: "2026-09-07T11:27:36Z"
---

# B262 — Every document still promises there will never be an editing interface, while one is being built

> **Rewritten 2026-09-07.** This was captured as *"writing to a journal
> requires bringing your own agent, so an owner without one cannot write at
> all"*, and asked for a plan before any UI. That plan exists —
> `docs/plans/2026-09-07-web-helper-agent.md` — the direction it chose is a
> guided helper at `/agent` rather than a CMS, and B681–B689 and B694 are
> building it. What survives from the original capture is the half nobody has
> done: **the documents still say the opposite of what is shipping.** The
> ticket is now that, and nothing else. The original reasoning is kept below
> the line as the record of how the question was framed.

## Why

`docs/ROADMAP.md` decision 24 reads *"The frontend has no editing UI, ever"*,
and `AGENTS.md` opens with *"there is no editing interface — no web form, no
upload widget, no CMS — and there will not be one (ROADMAP decision 24)"*.
Both are false the moment B682 merges: `/agent` is a browser, a person signs
into it, and a day comes out.

Decision 24 has been amended twice already — by B283 for the handover
credential and by B619 for the owner's own two forms — so the style for this
exists in the table and the argument does not need re-inventing. What it has
never carried is the change that matters most to a reader: that a person with
no agent of their own can now write.

This is not pedantry about a table. Both files are read by agents as
instructions, and one of them is the first thing any session here loads. An
agent that reads the current text while working on the helper has been told
the feature it is building is a mistake, and the honest readings available to
it are "remove it" or "the documentation is wrong". B100 is the same failure
mode in a different file and cost an afternoon.

`/agent.md` is the third copy, and it is served to whoever is *outside* the
checkout: it explains that browsers cannot write, which was the whole security
story. That sentence has to say what is now true — the browser still holds no
agent token, and the helper is not an exception to that, which is a narrower
and more interesting claim than the one it makes today.

## Work

- Amend decision 24 in `docs/ROADMAP.md` in the style of its two existing
  amendments: what the helper is, what it still cannot do, and why it is not a
  CMS. The distinction to keep is the one the plan draws — a person describes a
  day and a model writes it, which is the agent path with the agent supplied,
  not a form that maps fields onto frontmatter.
- Correct the paragraph in `AGENTS.md` that cites it, and the "one rule"
  section that follows. `status: draft` and the separate publish call are
  unchanged and should be stated as unchanged — B28, B223 and B224 are the
  history of getting that wrong, and a helper that saved straight to live would
  be the fourth time.
- Correct `/agent.md` where it claims a browser cannot write.
- Say in all three that the capability is off by default, so a self-hoster who
  agrees with decision 24 as written keeps a site with no editor in it.

Not doing: any code. If a document and the code disagree here, the code is
right and this ticket is only the writing.

## Acceptance

- No document promises there will never be an editing interface.
- Decision 24 carries a third amendment naming the helper, and `AGENTS.md` and
  `/agent.md` agree with it.
- The draft rule and the owner-only publish call are still stated, in all three
  places, as things the helper does not change.

---

## The original capture, 2026-09-04

Kept because it is the record of how the question was put, and of the security
property that had to be answered before anything was built.

The asked-for shape was a `/agent` route where a person signs in or creates an
account and manages their journal from the browser. The objection was never the
forms; it was that decision 24 is a security position — agent tokens arrive in
`Authorization: Bearer` and nowhere else, guest sessions arrive in a cookie and
nowhere else, `resolveSession()` refuses to treat one as the other, so that
reading the site on your phone cannot put a credential that rewrites it in your
pocket. A browser that writes needs a cookie session that writes, and whatever
was built had to say what replaced that property.

`docs/plans/2026-09-07-web-helper-agent.md` is the answer that was given, and
B681 is where the session handling was decided.

---

## What changed while building (2026-09-07)

`/agent.md`'s text turned out to live in `lib/api/documentation.ts`
(`agentGuide()`, served by `app/agent.md/route.ts`) — on B694's exclusion list,
not this ticket's. Left untouched here; B694 (in `in-development/`,
`docs/tasks/in-development/B694-the-landing-page-sends-everybody-off.md`) is
carrying that copy. Only `docs/ROADMAP.md` decision 24 and `AGENTS.md` were
amended.

What shipped and is confirmed in code, not just the plan: `app/agent/page.tsx`
(B681, in `testing/`) and the wizard (B682, in `testing/`) — a person with no
agent signs in at `/agent` and a day comes out, `status: draft`, behind the
`helper` capability which is off by default. B683 and B684 (uploads, spoken
notes) are still `in-development/`; B685–B689 (router, transcription,
photo captions, signup-in-wizard, import) are still `backlog/`. The amendment
cites B681/B682 as what actually landed and names B683–B689 only as "the rest
of the wizard", rather than claiming any of that later work is done.
