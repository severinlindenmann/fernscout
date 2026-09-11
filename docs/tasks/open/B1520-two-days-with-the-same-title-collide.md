---
id: B1520
title: Two days with the same title collide at publish with 409, and nothing catches it first
type: ISSUE
priority: medium
complexity: low
area: helper, api
found: "2026-09-11T19:20:00Z"
---

# B1520 — Two days with the same title collide at publish with 409, and nothing catches it first


## Status — not started; do not confuse with the local-slug fix

Untouched. `validate-content` still cannot see this collision.

One thing to keep straight, because the two look alike: `build.mjs` in
`fernscout-helper` was separately fixed on 2026-09-11 so that its **own**
filenames and media folders are unique (ten Phuket days had all resolved to
`media/phuket-island/` and overwritten each other). That is a different bug with
a different cause. **This** ticket is about the slug the *instance* derives from
a day's title, which distinct filenames actively hide.

## Why

Hit live on 2026-09-11, on the last of 23 days, after 177 photographs had
already been uploaded.

A day's slug on the instance is derived from its **title**, not from the
filename the helper wrote. Two days in the trip were both called `Downtime` —
deliberately, in three locales, because that is what the owner said both days
were. Distinct filenames (`2025-09-07-downtime-phuket.md`,
`2025-09-15-downtime-daheim.md`) hid the collision completely.

The instance's refusal was excellent:

> `409 an entry already exists with the slug "downtime" in this trip —
> 2025-09-07-downtime.md. A slug is a day's address within its trip and only one
> day can hold it… give this day a title that differs in a word.`

It named the other file and said what to do. The problem is **when** it arrived:
at step 50 of 52, after every upload. `validate-content` checks for two files
sharing a slug — it is one of the five things it keeps for itself, because only
a folder can answer it — but it compares *filenames*, which were different here.
It cannot see the collision the instance will compute.

## Work

In `fernscout-helper`'s `validate-content`: slug the way the instance does and
compare **that**, alongside the filename check that already exists. Two days
whose titles slug the same is an error before anything is sent, with both
filenames named, the way the instance names them.

The slugging rule has to come from the instance rather than be reimplemented —
that is this repository's whole arrangement with the helper. Either publish it
in `content-model.json` (a named check, like `day-translations-match-locales`),
or expose a dry-run that reports the slug a title would take. The first is
cheaper and needs no round trip.

Worth noting for whoever picks this up: the same derivation makes a day's URL
follow its title, so this trip's addresses came out in Swiss German
(`saechs-stund-jetski`, `zrugg-uf-bangkok-d-hemmli-abghole`). That is working as
intended and is not part of this ticket.

## Acceptance

- Two entries whose titles slug identically are an error from
  `validate-content`, before any call is made.
- The message names both files and says a title must differ in a word.
- Distinct filenames no longer hide it.
