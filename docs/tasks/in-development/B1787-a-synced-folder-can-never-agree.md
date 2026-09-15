---
id: B1787
title: A synced folder can never agree with the site, because the weather it answers with may not be sent back
type: ISSUE
priority: medium
complexity: medium
area: Sync / weather
found: "2026-09-15T08:40:00Z"
started: "2026-09-15T08:36:21Z"
session: bc2533f4-ec0c-48c5-a804-21118288b081
claimed: "2026-09-15T08:36:21Z"
---

# B1787 — A synced folder can never agree with the site, because the weather it answers with may not be sent back

## Why

`weather` is the one field where what the instance **answers** is not something
a caller may **send**. A day written with `weather: true` comes back carrying a
reading with `source: "open-meteo"`, and every write route then refuses that
same document by name — correctly, since the name means "the server measured
this".

That asymmetry is fine for one write. It is not fine for a folder that is meant
to be a mirror, and B1782 only moved the problem rather than closing it: it
made `publish` hand the *ask* back instead of the answer, on the stated basis
that "the file on disk keeps the reading". But `fernscout-helper` also has a
converter that turns a reading it finds on disk back into `weather: true`, and
a journal that has been through it — 189 entries in one real case — now holds
the ask where the site holds the answer. Neither side is wrong by its own
rules, and nothing can make them equal.

Measured on fernscout.ch/severin, 2026-09-15, after a clean
`sync down --prefer-remote` reported `pull 0, unchanged 4994`:

- `sync up` immediately planned `push 140`, of which **139 differ from the site
  in the `weather` field and nothing else** — verified by diffing every one of
  them with that field removed.
- The two legs disagree about those same files: `down` calls them unchanged and
  `--prefer-remote` does not rewrite them; `up` calls them "changed locally".
  They are in the site's own manifest, so "local-only" is not true of them
  either.

So `sync down --prefer-remote` does not do what its name promises for this
field, and a user who runs `up` gets 139 pointless writes that re-ask for
readings the site already has — and the next run plans the same 139 again. It
never settles. On a journal this size that is a permanent 2 MB of noise hiding
any push that actually matters.

## Work

The field needs one rule that both directions can satisfy. Options, in the
order worth considering:

1. **Let a reserved-source reading be sent back unchanged when it is
   byte-identical to what the server already holds for that day.** A no-op
   write is not a claim, and this makes "the folder keeps the reading" true in
   both directions. The refusal stays for any reading that differs.
2. **Have the manifest hash the day document with `weather` normalised**, so
   the two representations of the same fact hash alike and neither leg sees a
   difference.
3. **Answer writes with the ask rather than the answer**, and let the reading
   be fetched separately — the cleanest model, the largest change.

Whichever is chosen, the two sync legs must agree: a file cannot be "unchanged"
to `down` and "changed locally" to `up` in the same run against the same
baseline. That disagreement is worth a test of its own regardless of which
option lands.

## Acceptance

- On a journal whose days carry server-measured weather, `sync down` followed
  by `sync up` plans zero pushes, and running either twice changes nothing.
- `sync down --prefer-remote` leaves no file that `sync up` then reports as
  changed locally.
- A caller still cannot invent a reading and label it with a reserved source —
  the refusal that motivated it is unchanged, and has a test saying so.
- A journal that has been through `fernscout-helper`'s converter (days holding
  `weather: true` where the site holds a reading) reaches agreement without a
  person editing files by hand.

## Where this was found

Reported from `fernscout-helper` while syncing a 26-trip journal; the helper
side of it is `\.claude/skills/sync/sync.mjs` and the note in
`publish.mjs` at B1782.
