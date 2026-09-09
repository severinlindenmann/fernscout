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

## Step 3 — draw before and after

A visible change is a *change*, so one state is never enough. Each gets two
small boxes side by side: the old behaviour and the new, plain HTML and CSS,
or an inline SVG for a map or a printed page.

Ground both halves in the diff. The "before" is the harder one and the one
worth getting right — it is what the person remembers, and it is the reason
the row is on the page at all. Where the before-state is an absence (a border
that rendered as nothing, a video row that never appeared, a list that simply
ended), draw the absence rather than describing it.

Keep them small. These are diagrams of a mechanism, not screenshots, and a
sketch that implies more certainty than the diff carries is the same failure
as an invented summary.

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

No decision bar. `triage-a-backlog` ends in a choice; this ends in a handover,
and buttons on finished work would only invite a person to re-decide something
already merged.

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

## Step 6 — hand it over

Give the URL, then three or four sentences the page cannot say for itself: the
single most consequential fix and why, the one that surprised you, the pattern
across the run (four tickets against one deleted module; two duplicate pairs
filed seconds apart), and anything you reported on thin evidence.

Then stop. Do not move anything to `completed/` — that is the person's gate,
and a report is not a substitute for their eyes.
