---
id: B1787
title: A synced folder can never agree with the site, because the weather it answers with may not be sent back
type: ISSUE
priority: medium
complexity: medium
area: Sync / weather
found: "2026-09-15T08:40:00Z"
started: "2026-09-15T08:36:21Z"
merged: "2026-09-15T08:54:49Z"
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

## Built, 2026-09-15 — fernscout-helper `ea3bec0`, `b0e9bea`

**Valid when taken. The asymmetry is real and the Why is right about it — but
two things in it do not survive reading the code, and both change the fix.**

**1. The server already does option 1, and has for some time.**
`stripWeatherEcho` (`lib/api/v2/days.ts:66`) drops a `weather` value identical
to the stored one before the schema sees it, and `resolveStatusEcho` beside it
does the same for `status`. "A no-op write is not a claim" is already this
server's rule. Demonstrated: the site's own copy of
`davos-2026/2026-01-30-skischuhe-und-ski-gemietet`, fetched from
`/sync/file/…` and PATCHed straight back with `?dryRun=true`, answers 200 with
`source: "open-meteo"` intact. Option 1 was therefore not available to build,
and options 2 and 3 are not needed: nothing in this repository changed.

**2. `weather` is not the only such field — `status` is the other**, and the
acceptance cannot hold without it. A day states it arrives as a draft; whether
it is published is a separate call. So a folder synced down holds `draft`
where the site says `published` for exactly the reason it holds `weather: true`
where the site holds the reading. On the real journal, 199 files were in that
state — more than the 189 the ticket counted, because it was only looking at
weather.

**What could not be reproduced**: "the next run plans the same 139 again". A
completed `sync up` does record them. `weather: true` is an *instruction*, so
the server re-runs the lookup and `recordedAt` moves — measured, 08:36:07 →
08:48:00 for the same reading — the remote hash therefore moves, `landed()` is
satisfied, and the baseline is written. What the ticket measured was a `down`
run, which never pushes at all and leaves them planned. The real journal's
139 had already been recorded by a plain `publish` run through B1775's
`recordAgreed`, which is why the folder no longer showed them when this was
taken.

**What was reproduced, live, on that journal** — with the baseline entry for
one day removed, which is what a converted folder is:

- `sync up` **stopped the whole run**: `1 file changed on both sides since the
  last sync. Nothing was written.` One fact in two spellings, read as two
  people editing one day.
- `sync up --prefer-local` sent it, and the correction changed nothing on the
  site except to re-run the weather lookup and move `recordedAt` — which then
  gave the next `down` leg something to pull. Traffic both ways, for no
  content.
- `sync down --prefer-remote` could not reach it either way: the site's favour
  resolves conflicts, and a file the baseline remembers on both sides is not
  one.

**Chosen with the owner: fix it on the client, leave the refusal alone.**
Before anything moves — on both legs, and before the conflict check — every
document the two sides spell differently is compared through `sameAsWritten()`
(`shared/api.mjs`): both sides folded through `asWritten`, the site-owned
`status` dropped, key order canonicalised. When the two say the same thing
there is nothing to send, so the site's copy is written to disk, the run names
what it took, and the path is recorded as agreed. Anything differing in a
field the site does not own is pushed exactly as before.

The candidates are every `.json` both sides hold and spell differently, not
only the ones `plan()` picked out: a baseline that remembers both spellings
hides the rest, so nothing is planned, nothing looks wrong, and the folder
quietly is not a mirror. Once taken they stop differing, so it is one pass over
a converted journal and nothing afterwards.

## Verified, fernscout.ch/severin, 2026-09-15

- **Zero pushes, and running either leg twice changes nothing.** The real run
  took 199 files; `sync up --dry-run` then plans `push 1`, `sync down
  --dry-run` plans `pull 0, unchanged 4994`, and a second pair says the same.
  The one remaining push is a photograph whose local bytes differ from the
  site's derivative — a different defect, captured as **B1789**, and the only
  reason the up leg is not literally zero.
- **`down --prefer-remote` leaves nothing that `up` calls changed locally.**
  Both legs now agree on all 4994 files; before the fix the same folder held
  199 that neither leg would resolve.
- **The refusal is unchanged.** `PATCH …?dryRun=true` with an invented reading
  labelled `source: "open-meteo"` still answers
  `400 invalid_request … weather: Invalid input`. Nothing in this repository
  was touched, and the client sends the site's own bytes only where the server
  itself recognises them as its own.

Keepers: four checks in `sync.test.mjs` — the ask and the answer it produced
are one document; the site's own draft-or-published is the site's to say; a
re-ordered key is not an edit; anything else that differs is still a push (a
title that moved, two readings from the same private instrument, a reading the
server did not make, re-ordered photographs). The helper's full `selftest.mjs`
is green.
