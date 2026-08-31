# Black-box testing

`SCENARIOS.md` is what somebody who knows the code should check. This is the
other half: **what people who have never seen it find out by using it.**

## Why it is run separately

Every other test in this repository was written by someone who knew what the
answer was supposed to be. That is exactly the blind spot: a check written
alongside the code tends to assert the behaviour the author had in mind, and
the failures that reach real people are the ones nobody thought to have in
mind. So this pass is run by testers with **no access to the source**, working
only from the URL and `/documentation.txt`, the same two things a stranger gets.

It is also the only honest test of the documentation. If an agent cannot keep
somebody's journal from `/documentation.txt` alone, the document is wrong,
however accurate each sentence in it is.

## The instances — one each

**Every tester gets their own copy**: its own content directory, its own
database, its own port. They are built identically and thrown away afterwards.

This is not fussiness. The first run shared one instance between four testers
who wrote, published and deleted underneath each other for half an hour, and
it cost the evidence for the two most serious visual findings — the trip they
concerned had been emptied by somebody else before it could be verified. It
also forced one tester to spend part of her session working out that the
journal changing under her was another tester rather than a defect.

Each instance has every capability on, no paid account anywhere, and trips
deliberately arranged so the roles differ:

```
example    usa-2026    current, public
           parks-2025  private, with a companion on it
           alps-2024   guest-only, password "alpenglow2024"
           asia-2023   unlisted, costs for guests only
bea        one trip, a second journal, to prove isolation
```

Mail is written to `content/<user>/mail/`; every emailed code is `123456`, and
the testers are told that a person reads it to them — which is what happens in
reality.

## The four roles

| | Sees the product as | Looks for |
| --- | --- | --- |
| **Owner** | the agent keeping somebody's journal | whether the documented workflow actually works end to end |
| **Guest** | a grandmother following a link, in a browser | whether a non-technical person can read it at all — layout, wording, phone |
| **Companion** | somebody who was on one of the trips | whether shared authorship works, and stays inside its trip |
| **Adversary** | authorised security testing | the draft rule, private trips, cross-journal reach, SSRF, path handling |

Roles overlap on purpose. Two testers finding the same thing from different
directions is a stronger signal than one finding it once, and the ways they
*disagree* — the owner calling something obvious that the guest could not find
— are usually the most useful lines in the report.

## Rules the testers work under

- No source access, no git history. Only HTTP, a browser, and what the site serves.
- Findings written **as they go**, not at the end.
- One severity per finding: `BLOCKER` / `BUG` / `SECURITY` / `UX` / `DOCS`.
- Every finding carries what was expected, what happened, and how to reproduce it.
- Try it twice before reporting it, and say so when unsure. A short accurate
  report beats a long speculative one.

Results are consolidated into `RESULTS-<date>-blackbox.md`, deduplicated across
roles, with a triage order. Nothing is fixed during the run: the point is an
honest list, not a tidy one.

**Every consolidated finding says whether it was reproduced.** Testers with no
source access are working from inference, and the first run produced three
confident findings that turned out to be wrong — a "missing" close button that
was plainly visible, a `409` reported as a `201`, and a scope bypass that was
really a narrower problem. Passing those on unchecked would have cost more time
than the run saved. Reproduce first; record the refutations too, because a
tester's confident wrong answer usually means something on screen is genuinely
misleading.

**One instance per tester.** The first run shared a single mutable instance
between all four, and they overwrote each other's content — which cost the
evidence for the two most serious visual findings, because the trip they
concerned had been emptied by somebody else before it could be verified.
