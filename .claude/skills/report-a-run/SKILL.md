---
name: report-a-run
description: Turn a finished batch of tickets into one artifact a person reads in five minutes — what shipped, what turned out already fixed, what a person can actually see, and what still needs their eyes. Use when the user says "summarise what you did", "what changed", "did you fix any visual stuff", "write up the run", or after clearing a lane of docs/tasks.
---

# Report a run

A long autonomous run ends with the agent holding everything and the person
holding nothing. `git log` is forty merge commits; `docs/tasks/testing/` is two
hundred files. Neither answers the question actually being asked, which is some
version of **"what is different now, and what do you need from me?"**

This skill turns a finished batch into **one page**. It is the mirror of
`triage-a-backlog`: that one sorts work nobody has started, this one accounts
for work already merged. Same palette, same density, opposite tense.

## The one rule

**Report what happened, not what was attempted.** A run that closed eleven
tickets as already-fixed did not fix eleven things, and saying so plainly is
the entire value of the page. The temptation at the end of a long run is to
let the tally do the flattering; a reader who later discovers that a third of
the "wins" were stale tickets will not trust the next page either.

Two things follow:

- **Every claim is checked against the tree, not against a subagent's report.**
  A dispatched agent's summary is a claim. Before it goes on the page, read the
  merged diff, the locale value, the actual constant. On one run the reported
  strings and the shipped strings differed in three places, all innocently.
- **An unmet acceptance line stays unmet on the page.** If a ticket shipped
  with a line nobody could demonstrate, it is a row in "what still wants your
  eyes", not a silent omission.
- **A visible change was checked on content nobody wrote for the check**, or
  the page says which content it was checked on. "The dual clock works" and
  "the dual clock works on the two demo days this change edited" are different
  claims, and only the second was true of B42 — every day that already existed
  showed nothing. Drawing a before-and-after from a fixture built to make the
  after look right is the most flattering mistake available here, and the
  hardest for a reader to catch.

## Step 1 — establish what the run actually was

Do not reconstruct from memory; memory is what you are trying to check.

```bash
git log --oneline --since="<when the run began>" --format="%s" | grep -E '^(Merge )?B[0-9]+'
find docs/tasks/testing -name '*.md' -newermt "<when>"
ls docs/tasks/backlog/superseded/
```

Sort every ticket into exactly one of four, and keep the counts honest:

| | |
| --- | --- |
| **Merged with a real change** | code moved; there is a diff to point at |
| **Already fixed** | stale, superseded, or duplicated — no diff of its own |
| **Investigated, no change** | measured, and the honest answer was "nothing here" |
| **Captured, not built** | new tickets the run produced |

The last one is not padding. A run that filed seventeen captures found
seventeen things, and the person needs them counted somewhere.

## Step 2 — find the visible half

This is the question people actually ask, and it is answerable mechanically:

```bash
git log --since="<when>" --name-only --format="" | sort -u \
  | grep -E '^(components/|app/|site/locales/en\.json)'
```

A change is **visible** if a person meets it: copy, layout, a control, a
colour, a printed page. A change is **quiet** if only a screen reader or a
keyboard meets it — those get their own short section and are never dropped,
because they are total for the person affected and invisible to everyone else.

**Read the shipped value, not the report.** For a locale key:

```bash
python3 -c "import json;print(json.load(open('site/locales/en.json'))['agent.uploadTitle'])"
```

Quote it exactly on the page. A paraphrased string is a small lie that the
reader has no way to spot.

## Step 3 — show before and after

A visible change is a *change*, so one state is never enough. Each gets two
small boxes side by side: the old behaviour and the new.

**Where a run directory holds real captures, use them.** A run driven through
`check-page.mjs` (the capture step under `.claude/skills/test-in-a-browser/`,
per B1097) leaves `.claude/runs/<run-id>/<ticket-id>/{before,after}-<width>.png`
with a sibling `.json` beside each — url, status, title, innerText,
consoleErrors, failedRequests. Where a ticket's directory has these, embed the
actual PNGs as `data:` URIs rather than drawing anything, and beneath each one
say the three things the JSON knows and a sketch never could: the URL it was
taken on, the width, and whether that page existed before the branch (a
`before-*.png` that is missing, or whose JSON reports a non-2xx `status`, means
it did not — say so, do not paper over it with the after image twice). Watch
the artifact's 16 MB ceiling: `data:` URIs count against it, and a run with
several captures needs each one downscaled before it goes in, not left at
whatever size the browser produced.

**Where there is no capture, fall back to a sketch — plain HTML and CSS, or an
inline SVG for a map or a printed page — and label it as one.** A sketched box
gets a small caption saying so ("sketch, no capture") so a reader can never
mistake a drawing for a photograph. Ground both halves in the diff, exactly as
before: the "before" is the harder one and the one worth getting right, and
where the before-state is an absence (a border that rendered as nothing, a
video row that never appeared, a list that simply ended), draw the absence
rather than describing it. Keep sketches small — they are diagrams of a
mechanism, not screenshots, and a sketch that implies more certainty than the
diff carries is the same failure as an invented summary.

Either way, the rule from above still applies in full: **a real photograph is
evidence to check against the tree, not a replacement for checking.** A
capture proves what a browser rendered at the moment `check-page.mjs` ran, not
that the run's summary of it is accurate — read the JSON's `status` and
`consoleErrors` yourself before trusting what a subagent said about the page.

## Step 4 — the artifact

Load `artifact-design` first. Use this repository's own system — the palette in
`app/globals.css` via `apply-the-brand`, and the three faces `app/layout.tsx`
already loads (Fredoka display, Plus Jakarta Sans body, IBM Plex Mono for ids
and strings). Cream ground, navy ink, waymark yellow as the single accent;
green for the new state, coral for the old.

In this order:

1. **The tally** — cleared, visible, real changes, already fixed, captured.
   Five numbers, and the flattering one is not first.
2. **The visible changes**, grouped by *where a person meets them* — writing a
   day, money, signing in, the printed book — never by ticket type or
   priority. The grouping is the argument: it says what part of the product
   moved.
3. **The quiet section** — a11y and anything with no pixel, one line each.
4. **What still wants your eyes** — the closing box, and the point of the page.

## Step 5 — the closing box, which is the whole point

Everything above is reporting. This is the ask, and it should be the only part
that reads like a request:

- a drawing an agent judged from its own output rather than a printed page or
  a real browser;
- a value derived rather than specified — a colour the brand never named, a
  threshold nobody tuned;
- an acceptance line that could not be demonstrated, and what would demonstrate
  it (a CI run with a particular variable set, a phone at 390px, a live model);
- anything closed on an agent's judgement where the repository says a person
  decides — `wontDo:`, promoting to `completed/`, a product question with two
  defensible answers.

Name the ticket id and say what would settle it. "Needs review" is not an item;
"B1000 was checked as a rendered PDF, not a printed page" is.

## Step 6 — the acceptance gate

`testing/` → `completed/` is the second of the two human gates (AGENTS.md,
Tasks) and an agent never passes it — but until B1111 this page ended at the
closing box with nowhere to record the answer. A person read the page,
decided, and then had to compose the move by hand, or, far more often, did
not: the lane accumulated until 284 tickets were cleared in one sentence on
2026-09-09, all at once, none of them individually recorded. The reasoning
this skill used to give — that buttons on finished work would only invite a
person to re-decide something already merged — had it backwards. The buttons
below are not re-deciding merged work; they are the acceptance gate itself,
finally given a surface. The closing box above is unchanged by any of this:
it is what the person reads *before* they touch a button here, never folded
into the gate itself.

Build it on exactly the machinery `triage-a-backlog` step 6 already
describes — localStorage under a versioned key, the honest clipboard report
(`navigator.clipboard.writeText`, reporting "Copied to your clipboard" only
when the promise resolves and "Select all and copy" otherwise), the readonly
textarea fallback, never a download — rather than building a second version
of the same thing:

- Every ticket row carries two verdicts, nothing pre-selected. The sticky
  bar's tally counts the undecided, the same shape as the triage bar's own
  running count.
- **Label each verdict by what it does, never by a mood.** "Accept" (→
  `completed/`) and "Hold to see live" (→ stays in `testing/`), with a
  one-line legend above the rows saying where each sends the ticket. B1152 is
  why: a button first labelled "needs another look" told the owner nothing
  about its consequence — the same failure `ConfirmPanel` was built to end
  ("a button that says what it *does* rather than OK"). A verdict is a
  destination, so name the destination.
- Every row also carries a note field, open on both verdicts. Whatever is
  typed there is carried into the generated text beside that ticket's id —
  "accepted, but the spacing at 390 is tight" is a sentence the next agent can
  act on, and it is the entire reason the field exists: a page that outputs
  only a list of ids has thrown that away. An empty note contributes nothing
  to the output — no blank bullet, no placeholder line.
- *Build the list* writes a markdown block that starts with one paste-ready
  line — `move B1097 B1099 B1100 to completed`, the accepted ids, in order,
  nothing else — so a person can hand it to an agent with nothing added.
  Below that line: the accepted tickets that carry a note, each with its
  note; then the tickets held to see live, each with theirs.

**The gate is a control surface, not a document — so it obeys the UI half of
`artifact-design`, not the prose half the rest of this page follows.** Three
things follow, and all three were faults the owner hit in the gate's first
real minute (B1152); none of them is catchable by a test:

- **A chosen verdict fills solid** — the semantic colour as the button
  *background* with contrasting text, not a pale tint behind coloured text. A
  tint reads as no change at all; the selected state has to be legible across
  the room, not on inspection. State shows in form, not only in a word.
- **A person can reach what they are deciding on.** Each row's id is a control
  that scrolls to and briefly highlights that ticket's card above (give the
  card `scroll-margin` so the sticky bar does not cover it). A decision
  surface that makes somebody hunt up the page for the evidence gets decided
  blind.
- The narrative report above the gate stays a document. Only the gate is a
  control; do not let the two blur.

This still moves nothing. `completed/` is a person's gate, exactly as
`open/` is in `triage-a-backlog`, and the deliverable is text in a
clipboard — a person pastes it, or hands it to an agent that reads
`move B1097 … to completed` and runs `manage-tasks` accordingly. Neither this
page nor the run that produced it touches a task file.

## Step 7 — hand it over

Give the URL, then three or four sentences the page cannot say for itself: the
single most consequential fix and why, the one that surprised you, the pattern
across the run (four tickets against one deleted module; two duplicate pairs
filed seconds apart), and anything you reported on thin evidence.

Then stop. Do not move anything to `completed/` yourself — that is still the
person's gate; the page above only gives them the words to do it with.
