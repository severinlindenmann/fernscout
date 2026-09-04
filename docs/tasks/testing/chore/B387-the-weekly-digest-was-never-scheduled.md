---
id: B387
title: The weekly digest was never scheduled or wanted, and is a second mail system to keep correct
type: CHORE
priority: medium
complexity: medium
area: digest, mail
found: "2026-09-05T00:15:00Z"
started: "2026-09-04T22:11:32Z"
merged: "2026-09-04T22:21:39Z"
---

# B387 — The weekly digest was never scheduled or wanted, and is a second mail system to keep correct

## Why

The owner's decision, in their own words: *"can you get rid of the weekly
digest? i never implemented that or wanted that."*

The evidence agrees. **Nothing schedules it.** There is no timer for it in
`deploy/` — `fernscout-backup.timer` is the only one — and
`deploy/fernscout-worker.service` says in its first line that nothing enqueues
work yet. `runDigest` fires only when somebody types `npm run digest`, which
on this instance nobody has. It has been a feature in the repository and never
a feature of the site.

It is not free to keep. It is a **second reader-facing mail system** beside
the day letter (B345), with its own recipient resolution, its own visibility
gate (`digestableTrips`), its own quiet rules, its own send-record table and
its own template — every one of which is a thing that has to stay correct as
the trip gates change. B380 is the case in point: the credit system charged
the day letter and not this, so a journal at zero credits could not announce
one day and could still mail its whole readership. That bug existed only
because there were two senders.

The day letter does what this was for, better: it goes out when a day is
published rather than on a schedule, and it is the thing the owner actually
asked for.

## Work

**Delete the weekly digest. Keep everything the day letter needs.**

The split is not the folder — `lib/digest/` holds both features — so it is
worth writing down which is which.

Delete:

- `lib/digest/index.ts` — `planDigest`, `runDigest`, `DigestOutcome`. Imported
  by `scripts/digest.mts` and two test files and by nothing under `app/`,
  which is what makes this a clean removal.
- `lib/digest/mail.ts` — `renderDigest`, this letter's own template.
- `lib/digest/record.ts` — the `digest_sends` claim/mark bookkeeping.
- `lib/digest/visibility.ts` — `digestableTrips`, once `index.ts` is its only
  non-test caller. Confirm with `npm run unused` rather than by eye.
- `scripts/digest.mts` and the `digest` entry in `package.json`.
- `test/digest.test.ts`, and the digest half of
  `test/mail-journal-switch.test.ts` (its day-letter and capability cases
  stay).
- A migration dropping `digest_sends`, plus its row in `TABLE_NAMES` and its
  `DigestSendsTable` type. `004-digest.ts` is **not** edited — a migration
  that has run anywhere is history and is never rewritten; the new one undoes
  it going forward. Its `down` recreates the structure, not the rows. The
  owner chose this over leaving a dead table.
- The digest-only strings in all three locales: `digest.intro`, `digest.more`,
  `digest.moreOne`, `digest.subject`, `digest.subjectOne`, `digest.title`,
  `digest.titleOne`, `digest.button`.

Keep, and do not be misled by the name:

- `lib/digest/dayLetter.ts`, `dayWhatsapp.ts`, `dayPhoto.ts` — B345/B365, the
  feature that is wanted.
- `lib/digest/content.ts` (`dayUrl`, `formatDigestDate`) and
  `lib/digest/quiet.ts` (`journalTimezone`) — both imported by `dayLetter.ts`.
  Delete only the parts that nothing else reaches, and let `npm run unused`
  say which those are rather than guessing.
- **`contacts.wantsEmailDigest`, the column and the consent.** It is the
  day letter's own opt-in (`dayLetter.ts` gates on it) and is read in fourteen
  files. It is not renamed here: a column rename is a migration and a
  fourteen-file edit for a word, and the reader-facing label already says the
  right thing — *"Send me an email when there are new days to read"* — which
  describes the day letter exactly. Anybody who ticked that box consented to
  what they will still receive.
- `digest.greeting`, `digest.footer`, `digest.preferences` — the day letter
  renders all three.

Take the migration number from `ls lib/db/migrations` at the time of writing;
several are in flight.

### Not in this ticket

- Renaming `wantsEmailDigest`, `lib/digest/`, or the surviving `digest.*`
  translation keys. Worth doing, and it is a rename touching fourteen files
  plus a column — its own ticket, and it should not ride along with a
  deletion where a mistake is harder to see.
- Any change to what the day letter sends or who receives it.
- Bringing a scheduled summary back in another form.

## Acceptance

- `npm run verify` green, and `npm run unused` clean — the latter is what
  proves nothing was left orphaned, and is the reason to run it here rather
  than leave it to CI.
- `grep -rn "runDigest\|planDigest\|renderDigest\|digest_sends" lib app scripts`
  returns nothing outside the migration history.
- `npm run digest` is gone from `package.json`.
- The day letter still works end to end: publish a day with `send_mail: true`
  against a journal with contacts, and read the `.eml` under
  `content/<user>/mail/`. Its greeting, footer and preferences line all still
  render, being the shared strings.
- A reader who had `wantsEmailDigest` set still receives that letter — the
  consent survived the deletion.
