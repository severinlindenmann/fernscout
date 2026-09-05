---
id: B499
title: Nothing shows an agent how to build a character, and the demo journal has one party shape
type: DOCS
priority: medium
complexity: low
area: travellers, demo content, agent-interface
found: "2026-09-05T16:28:47Z"
started: "2026-09-05T16:29:15Z"
merged: "2026-09-05T16:41:46Z"
---

# B499 — Nothing shows an agent how to build a character, and the demo journal has one party shape

## Why

Two halves of one problem: an agent asked to draw somebody has the vocabulary
but no worked example, and a person looking at the demo journal cannot see
that parties have shapes at all.

**The reference is complete and the instructions are thin.** `GET
…/travellers/presets` returns every word a figure takes, which answers *what
may I say* and not *how do I build one*. `/agent.md` has a section that argues
the rules — ask, never infer, show before writing — and does not once show a
figure being assembled from an answer. An agent that has read all of it still
has to guess at the shape of the object it is meant to POST.

**The demo journal draws the same party five times.** Four of the five trips
have no `travellers:` block at all, so they render one neutral figure each;
`usa-2026` has a couple. Nothing in `content/example/` shows a family, a group,
a solo traveller, or the journal-level default — so the arrangement work in B11
(children in front, ranks alternating past three, the overlap) is invisible to
anybody looking at the demo, which is the thing the demo exists for.
`docs/README.md` calls the demo content what an agent learns the model from.

## Work

1. **A worked example in the guide.** One conversation end to end in
   `/agent.md`: the question, a person's answer in ordinary words, the figure
   it maps to, the preview URL, the read-back naming what stayed at the
   default, and the POST body. Prose about the rules stays; this is what was
   missing under it.
2. **`…/travellers/presets` explains its own fields.** It lists the values a
   field takes and never says what the field means or which are worth asking
   about. Add a per-field line, and the shape of a figure object, so the
   response is usable without also reading `/agent.md`.
3. **Give every demo trip a different party.** Solo, a couple, a family with
   children, a group of five, and one trip with **no block at all** so the
   journal-level default in `content/example/config.json` is demonstrated
   rather than merely documented.

Not doing: a second copy of the vocabulary anywhere. It lives in
`lib/travellers/vocabulary.ts` and is served from the presets endpoint; a
reference kept in two files disagrees with itself within a month, which
`AGENTS.md` says at length about exactly this kind of table.

## What building it turned up

**An upcoming trip has no hero.** The group of five was put on `japan-2027`
first, and it drew nothing: an upcoming trip renders the plan and the
countdown, not `TripHero`, so its `travellers:` block is never seen. Moved to
`asia-2023`, which is past and has a hero. Worth knowing before choosing where
demo content goes — four of the five trips render the party, and `japan-2027`
is the one that cannot.

The demo now covers every party size and both fallback levels:

| trip | party | shows |
| --- | --- | --- |
| `alps-2024` | 1 | a solo traveller |
| `japan-2027` | — | falls back to the journal's default (and is upcoming, so no hero) |
| `usa-2026` | 3 | a couple and an elder; the current trip, so it is what `/example` opens on |
| `parks-2025` | 4 | a family — two adults, two children in front |
| `asia-2023` | 5 | five friends, ranks alternating |

## Deploying demo content is a second, manual step

Worth writing down, because it cost a confused half hour and the next person
will hit it too.

`scripts/deploy.sh` deliberately does **not** copy `content/` into
`$CONTENT_DIR` — only `locales/`, `rates/` and `legal/`. It prints a note
saying so, which is easy to miss in the tail of a build log. On this instance
`CONTENT_DIR=/var/lib/fernscout/content`, so the demo journal a reader sees
lives there and is seeded by hand.

The trap is that `git pull` **does** update `/srv/fernscout/content/example`,
because that is the checkout. So the obvious check — ssh in, grep the trip
file, see the new block — passes while the live site still shows the old
party. The two directories are different and only one of them is served.

Deployed here by copying the four changed `trip.md` files from the checkout
into `$CONTENT_DIR` (the repo was a strict superset — zero live-only lines),
and by inserting only the `travellers` key into the live `config.json`, which
is hand-edited and says "Four journeys" where the repo says five. A backup of
the journal as it was is at
`/var/lib/fernscout/content/.example-backup-b498`; it is inert (a leading dot
cannot match `USERNAME_RE`, and `/documentation.txt` does not list it) and can
be deleted whenever.

Whether the demo journal *should* be hand-seeded is a real question and not
this task's — it is the reason the repo's copy and the live one had already
drifted before any of this.

## Acceptance

- `/agent.md` carries one complete worked example, answer to written block.
- `GET …/travellers/presets` says what each field is for, and shows a figure
  object.
- Each of the five trips in `content/example/` renders a visibly different
  party, and one of them has no `travellers:` block and falls back to the
  journal's.
- `.claude/skills/describe-a-traveller/SKILL.md` matches, without restating
  the vocabulary.
