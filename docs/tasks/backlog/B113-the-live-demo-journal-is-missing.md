---
id: B113
title: The live demo journal is missing its upcoming trip, so every planned-trip feature has no showcase
type: ISSUE
priority: medium
complexity: low
area: content, deploy, demo
found: "2026-09-03"
---

# B113 — The live demo journal is missing its upcoming trip

## Why

`content/example/` in the repository has five trips. `fernscout.ch/example` has
four: `alps-2024`, `asia-2023`, `parks-2025` and `usa-2026`. The missing one is
**`japan-2027`** — the only *upcoming* trip in the demo journal, and the only
one carrying a `plan.md`.

```
$ curl -s -o /dev/null -w "%{http_code}" https://fernscout.ch/example/trips/japan-2027/map
404
```

`/example/trips` lists three past trips plus the current one;
`/documentation.txt` advertises "4 public trips". The trip exists only on
somebody's disk.

This was found while verifying **B18** ("a planned trip's map page draws no
map"), and it is worth separating the two clearly, because the code is fine:

- The B18 fix **is** deployed. `/api/health` reports commit `3592ad3`, the
  guard in `app/[user]/(trip)/map/MapPageContent.tsx` is live, and the new
  locale keys (`map.empty`, `map.titlePlanned`) are in the served bundle. A
  trip with neither entries nor a plan correctly renders "Nothing to draw yet —
  no days written, and no route planned" under a "Where we're going" heading.
- What is missing is the **specimen**. B18's acceptance names
  `/example/trips/japan-2027/map` and that URL 404s, so the headline case — a
  planned route drawn as a dashed line with an `0 / 8` counter — cannot be
  reproduced *or* disproved on the live site.

What it costs, beyond one unverifiable acceptance line:

- **The demo journal demonstrates four of the product's five trip states.** An
  upcoming trip is the one a visitor sees the countdown, the planned route and
  the planned budget on. `/documentation.txt` points strangers at `example` as
  the thing to look at, and the feature set it shows is quietly incomplete.
- **Planned-trip regressions cannot be caught in production.** There is no trip
  on the instance that exercises the plan-rendering path at all, so B18, B54
  ("an upcoming trip's map is titled Where we've been") and any future
  plan-related change are verifiable only against a dev box.
- **There is no network path to substitute one.** `POST /api/v1/<user>/trips`
  accepts `{id,title,tagline,start,end,status,accent,visibility,listed,test,intro}`
  (`app/api/v1/[user]/trips/route.ts:108-119`) and has no `route`/`plan` field;
  nothing under `app/api/` writes `plan.md`, and the MCP tool list has no plan
  tool. So an agent testing the live instance cannot build the specimen it
  needs — it can only report the gap. That is arguably the more interesting
  half of this finding.

B56 is the neighbouring task and does **not** cover this. Its
`scripts/sync-shipped-content.sh` syncs `content/locales/` and `content/rates/`
— the shipped half — and deliberately never touches a `<username>/` directory,
because those are the operator's. `content/example/` is a journal by that rule,
so it sits on the wrong side of a line drawn for good reasons. That is the
mechanism; the question this task asks is what *should* happen to a demo
journal that ships in the repository but lives under the operator's half.


## A second instance of the same gap, found later the same day

`japan-2027` is not the only thing missing. Verifying **B78** turned up that
`content/example/trips/asia-2023/entries/` has **8** entry files in the
repository and **5** on the live server:

```
$ ssh 95.216.112.173 "ls /var/lib/fernscout/content/example/trips/asia-2023/entries/"
```

The three absent ones include `2023-01-08-leaving-zurich.md`, which B78 added
specifically so that a **flight** leg would be visible on the demo map.
`https://fernscout.ch/example/trips/asia-2023/day/leaving-zurich` answers 404,
and the asia-2023 legend on the live site lists Train, Boat and Motorbike — no
Flight. So the feature B78 shipped is invisible on the journal that exists to
demonstrate it.

This makes the pattern clear: it is not one forgotten trip, it is that **every
change to `content/example/` since the server was first seeded has stayed on
the author's disk.** Two tickets in one day landed demo content that never
arrived, and neither build could have noticed, because both verified against a
local checkout where the content was present.

That strengthens the first of the two options in Work below. A demo journal
that ships in the repository and is only ever edited there is shipped content
by every practical test, and the current arrangement means any task that
improves it silently fails to reach the thing it was improving.

## Work

Decide what `content/example/` is, then make the live instance match it.

Two coherent answers, and the first is probably right:

1. **It is shipped content, like the locales.** The demo journal exists to
   demonstrate the software, it is in the repository, and nobody hand-edits it
   on the server. Then it belongs in `sync-shipped-content.sh`'s fixed list and
   a deploy carries it, with the same "replaced, not merged" semantics the
   locales get. The risk to weigh: it would overwrite an operator's local
   changes to `example/`, which for a demo journal is the intended behaviour
   but must be *said*, in the runbook and in B56's own documentation.
2. **It is an operator's journal that happens to ship with the repo.** Then
   the deploy correctly leaves it alone and the fix is a one-off copy plus a
   runbook line telling an operator to seed it once.

Either way: get `japan-2027` onto the live instance and confirm
`/example/trips` shows five trips and `/documentation.txt` says so.

Not doing: adding a plan-writing endpoint to the API. An agent being unable to
create a planned route is a real gap, but it is a feature decision about the
write surface and it should not be smuggled in under a content fix. Capture it
separately if it is wanted — the trip write path is deliberately narrow and
`plan.md` may be meant to stay a file the author edits.

## Acceptance

- `https://fernscout.ch/example/trips/japan-2027/map` returns 200 and draws a
  map framing Japan, with the eight planned stops on a dashed route and a
  `0 / 8` counter — which is B18's acceptance, finally checkable.
- `/example/trips` groups five trips, one of them upcoming.
- `/documentation.txt` no longer says four.
- Whichever answer is chosen, it is written down: either `example/` is in the
  sync script's list and the runbook says a deploy overwrites it, or the runbook
  says how to seed it and that deploys will not.
