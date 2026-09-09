---
name: triage-a-backlog
description: Read a lane of docs/tasks in full and hand back one artifact — every ticket summarised, sketched where it has a visible face, sorted into promote / hold / don't do, with a decision bar the person fills in and pastes back. Use when the user says "triage the backlog", "ticket triage", "go through the issues", "what's in the backlog", "which of these should I do next", or names a folder and asks what is in it.
---

# Triage a backlog

The backlog is the part of this repository nobody can hold in their head. A
hundred and twenty files, one level down in category folders, each one a page
of prose. `npm run tasks` lists them; it cannot tell you which are worth doing,
which are blocked, or which would change something a person looks at.

This skill turns one lane into **one page a person reads in five minutes and
then decides from**. The deliverable is an Artifact, and the decision at the
end is theirs — never yours.

## The one rule

**You triage; the person decides.** A verdict you write is a recommendation
with its reasoning attached, and every ticket carries buttons so they can
disagree in one tap. Promoting a ticket into `open/` is a person's call
(AGENTS.md, Tasks) and this skill does not move a single file. It ends with
text in their clipboard.

The second rule follows from the first: **ground every sentence in the ticket
file.** A summary that invents a rationale the ticket does not carry is worse
than no summary, because it is confidently wrong and reads exactly like the
true ones. If a ticket is empty — a title and three TODO placeholders, which is
common — say so and triage it as blocked on itself. Do not fill in what its
author would probably have written.

## Step 1 — scope it, and say what you scoped

Ask which lane and which categories, unless the request already says. The usual
asks map like this:

| They said | You read |
| --- | --- |
| "the backlog" with no qualifier | `docs/tasks/backlog/` — every category |
| "features" | `backlog/big-feature/` + `backlog/small-feature/` |
| "bugs", "issues" | `backlog/issue/` |
| "what's waiting to be checked" | `docs/tasks/testing/` — flat, no categories |

`backlog/security/` is a deliberate decision, not a default: those tickets are
live findings. Include them only when asked, and never in an artifact the
person may share onward.

Count the files first and say the number before you start. Forty tickets is a
different job from four, and they should know which one they asked for.

## Step 2 — fan out, one subagent per batch of eight

One agent reading forty tickets runs out of attention around the twentieth and
starts writing shorter, vaguer records for the tail. Batches of eight on
`sonnet` do not, and they run at once.

Give every subagent the **same** prompt shape and the same schema, so the
records compose without reconciliation. Name the files explicitly — never
"read the folder", because two agents given a folder read the same tickets and
miss others.

```
Read these N task files in docs/tasks/<lane>/<category>/ IN FULL: <names>

For EACH ticket return a compact record. Do not write files.
Return ONLY a JSON array, one object per ticket:

{
  "id","title",
  "what": "1-2 sentences, plain language: the problem, and what would be built",
  "why":  "one short sentence: what it costs today",
  "area","priority","complexity",          // from the frontmatter
  "visual": true/false,                     // would a person SEE something change?
  "visual_desc": "if visual: 2-3 sentences concrete enough to sketch from",
  "touches": [ up to 6 files/routes the ticket names ],
  "effort": "S | M | L | XL",
  "triage": "promote now | maybe later | wont do",
  "triage_reason": "one short sentence",
  "risk": "one short phrase, or empty"
}

Ground everything in the ticket text; do not invent. If a ticket is stale,
empty, or already superseded by shipped code, say so in triage_reason.
```

Dispatch every batch in **one message** so they run concurrently, and never
pass `run_in_background` down into a subagent's own verify step.

## Step 3 — the three verdicts, and what separates them

The value of this page is the line between the middle two. Be strict:

- **Promote now** — scope decided, acceptance written, no unbuilt dependency
  and no open product question. Somebody could take this ticket tomorrow.
- **Hold** — genuinely wanted and genuinely stuck. Name *what* it is stuck on:
  an undecided product question, a ticket that has not been built, or a cost
  the ticket itself says is not due yet. "Feels big" is not a reason; "waits on
  B589" is.
- **Don't do** — structurally blocked, or the premise is wrong. Rare. This is
  *not* `wontDo:` in the frontmatter — that field is a person's word, and you
  are recommending, not recording.

Then look **across** the tickets for the thing no single record can see: the
one small ticket that unblocks four large ones, the two tickets that are the
same work, the "gap" that is actually a live bug. That paragraph is usually the
most useful thing on the page, and it is the only part a subagent could not
have written.

## Step 4 — sketch the ones with a face

A ticket whose `visual` is true gets a small mockup drawn from `visual_desc`:
plain HTML and CSS in a bordered box, or an inline SVG for a map or a chart.
Label it so nobody mistakes it for a screenshot — *what it would look like* —
because it is drawn from a description of intent, not from the running site.

Keep them small and honest. Grey bars for prose, a real sentence where the
ticket specifies a real sentence, and where the point is a before-and-after
(a map with no tiles beside one with tiles, a light page beside a dark one),
draw both halves side by side. A sketch that shows more certainty than the
ticket carries is the same failure as an invented summary.

## Step 5 — the artifact

Load `artifact-design` before writing it, and reach for this repository's own
palette (`app/globals.css`, via the `apply-the-brand` skill) — cream ground,
navy ink, waymark yellow as the single accent, green for go, sky for hold,
coral for stop. This is a tool, not a document: it is scanned, so lead with the
tally, keep the rows dense, and encode state in form as well as in words.

It needs, in this order:

1. A tally — how many in each verdict, how many have a visible face, big vs small.
2. Filters that survive a hundred rows: size, effort, visible-vs-plumbing, priority.
3. The tickets, grouped by verdict, each carrying id, title, what, why, the
   sketch, the files it touches, your verdict *with its reason*, and the risk.
4. **The decision bar** — below.

## Step 6 — the decision bar

This is the point of the whole page, so do not treat it as a footer.

Every ticket carries three buttons — **promote / hold / don't do** — with
**nothing pre-selected**. Your verdict is the sentence above the buttons; theirs
is the button. A choice that differs from your verdict is flagged *changed*, so
that when they paste the result back you can see where you were wrong.

A sticky bar at the bottom of the page holds a running tally (promote, hold,
don't do, undecided) and three controls: *start from my verdicts* (fills every
row with your recommendation, for somebody who wants to correct rather than
choose), *clear*, and *build the list*.

*Build the list* writes a markdown block that **starts** with one paste-ready
line: `plan-a-run` followed by the promoted ids, in order, and nothing else —
`plan-a-run B1091 B1092 B1057` — so a person can hand it to an agent with
nothing added. `plan-a-run` is the skill that takes that line and turns it
into a run; this one only has to produce a line it accepts. Below that line,
the existing grouped markdown list stands unchanged: each id, its title, and a
note where they overruled you, ending with the undecided ones, which matter as
much as the rest. Put the whole block in a `readonly` textarea,
selected, **and** attempt `navigator.clipboard.writeText`, reporting honestly
which of the two happened: "Copied to your clipboard" only when the promise
resolved, "Select all and copy" otherwise. Never offer a download — the artifact
sandbox blocks a page's own downloads, and a button that does nothing is worse
than no button.

Persist the picks to `localStorage` under a versioned key. Somebody working
through forty tickets will reload the page.

## Step 7 — hand it over

Give them the URL, then three or four sentences of the things the page cannot
say by itself: the cheapest wins, the heaviest ticket worth its cost, the small
one that unblocks a chain, and anything you found that is a live bug rather
than a gap. Say plainly which tickets you triaged on thin evidence.

Then stop. Do not move a task file, do not promote anything into `open/`, and
do not start building the first item. When they paste the decisions back, *that*
is when `manage-tasks` moves what they chose.
