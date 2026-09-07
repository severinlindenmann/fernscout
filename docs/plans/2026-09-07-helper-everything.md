# Every feature, friendly, in the helper

*Written 2026-09-07, after nine tickets shipped, six deploys, and seven people
walked through the live site. Supersedes nothing: `2026-09-07-web-helper-agent.md`
is what was built, `2026-09-07-helper-completeness.md` is the capability gap,
and this is the plan for closing it — ordered by what people actually hit,
with the persona that proves each round.*

## What testing changed about the plan

The completeness map ranked thirteen gaps by reasoning. Seven testers then used
the live site, and the order came out different. Three things nobody predicted:

**The second visit is the product.** Every test before this one was somebody's
first ten minutes. A person home three weeks later found that **four of the six
things she wanted to do had no button at all**: fix a typo, add a forgotten
photograph, enter her receipts, take a day down because a friend asked. The
browser is write-only, and then read-only forever.

**A wrong answer is worse than none, and we have both.** "Where's my stuff"
returned disk space at 0.72 confidence. "Take down the day with the photo of
anna" opened the screen that *creates* a day. The router's own prompt says a
wrong guess costs more than no guess; it is now measured, twice.

**The word people freeze on is not the word we expected.** Not "draft" — a
71-year-old understood that. It is **"Agent"**, and it is in the product's
name for the page.

## The rounds

Each round is a shippable set with a persona that decides whether it worked.
Rounds are ordered by how many people hit the thing, not by how interesting it
is.

### Round 1 — stop the harm (bugs)

| | |
| --- | --- |
| B817 | removal language must never open a screen that writes |
| B808 | "where's my stuff" must not answer with disk space |
| B807 | a lapsed session must say so instead of "not your journal" |
| B783 | a refusal must name itself and point somewhere |

**Validated by:** the 23-year-old who closed the tab when his session died, and
the 47-year-old whose takedown request opened a create screen.

### Round 2 — the second visit

| | |
| --- | --- |
| B816 | correct, add photographs to, and **take down** a published day |
| B818 | default the date to the day you have not written, not today |
| B819 | say which days of the trip were never written |

**Take down before correct**, if it splits: it is the one with somebody else's
consent behind it, and B28 is the reason this project exists.

**Validated by:** the 47-year-old, repeated. Same six tasks, counted again.

### Round 3 — money a person can reach

| | |
| --- | --- |
| B820 | one receipt, from the browser, onto the right day |
| B806 | say what a credit is worth in francs, once, where one is first spent |
| B810 | stop asking what a day cost before anything has been written |

**Validated by:** the 71-year-old, who put the phone down rather than press an
unpriced button, and the 23-year-old, who would have invented a number.

### Round 4 — the words

| | |
| --- | --- |
| B804 | give somebody with no agent permission to ignore the agent panel |
| B805 | the publish note in the reader's own language, "guest" included |
| B809 | two name fields nobody can tell apart |
| B785 | English API refusals shown on German screens |

**Validated by:** a German-speaking tester who has never used this software.

### Round 5 — everything else the API can do

The capability matrix in `2026-09-07-helper-completeness.md` is the source.
What remains, in the order an ordinary owner would miss it:

1. invite from the helper itself, not only from the day page (B799 shipped the
   day page; the ask box still has no row)
2. remove a photograph
3. journal settings — languages, units, currencies, journal visibility, none of
   which has *any* web surface
4. who is on a trip, and how the party is drawn
5. postcards and photobooks made discoverable (B436)
6. rates, tracks on and off, trip cover, trip intro prose

**Validated by:** a persona per capability, and the rule below.

## The ask box, when it is finished

Five rows today: `new_trip`, `write_day`, `storage`, `credits`, `unfinished`.
Every one of the misroutes above happened because the territory has no row and
the nearest neighbour won. The list it should reach:

| Row | Kind | Closes |
| --- | --- | --- |
| `fix_day` | open | B816 |
| `take_down` | open, refuses to write | B817 |
| `add_cost` | write, confirmed | B820 |
| `who_can_read` | read + link | invites, and half of visibility |
| `what_is_my_trip` | read | B783 |
| `send_to_family` | open | the announce pointer |
| `stage_file` | open | the inbox, now that a file can be chosen |

And a rule that is worth more than any row: **a sentence in a territory with no
row gets a named refusal, never the nearest neighbour.**

## How each round is validated

One persona per round is not enough, and the same persona twice is not either.
The pattern that has worked:

- **A first-timer** who has never seen it — finds the wall.
- **A returning owner** — finds what the product forgot exists.
- **Somebody who cannot see the screen** — finds what was never reachable.
- **Somebody on the other side** (a reader, a guest) — finds the half nobody
  built.
- **A sceptical technical user** — finds where the documentation lies.

Run at least three per round, and **retest a previous persona every time**: the
71-year-old's retest proved B786 worked and found that the same failure had
moved one screen later, which no new persona would have noticed.

## What must never be made friendly

Repeated here because every round above is a temptation to file a gate off:

- **Publishing** stays a person's decision, with a preview before it. An edit
  to a published day is not a publish.
- **Deletion** ends in a mailbox. A `202` is not "deleted".
- **Postcards** are previewed and pressed by the owner; addresses never reach
  an agent; nothing under `app/api` imports `sendOrder`.
- **A guest link and a buddy link never share a button.** One goes in the
  family group chat; the other is write access.
- **Trip visibility is asked at creation**, in words that distinguish "everyone
  I let into this journal" from "the people who were there".
- **The model never writes weather and never writes what happened.**
- **`gps/` stays unreachable.** No row, no route, no coordinate in a prompt.
- **Nothing over HTTP grants credits** except the signup grant, which stays
  below the cheapest thing a printer would bill for.

## The measure

Not "every endpoint has a screen". The measure is: **a person with no agent,
no API and no help can keep their journal** — write it, correct it, show it to
their family, take something down when asked, and know what it costs. Anything
that does not serve that is completeness for its own sake, and the matrix
already says which rows those are.
