# Getting your own data out

## Photographs with their location

A photograph carries its coordinates in its own EXIF data, written by the
camera at the moment it was taken. That is the only place this software reads
a location from — `lib/extract/analyse.ts` pulls `lat`/`lng` straight out of a
staged file's EXIF and fills in nothing else; a photograph with no EXIF
location produces a day with no location, never a guess. `readExif` (see
`lib/ingest/exif.ts`) reads JPEG, HEIC and WebP. A video's own coordinates,
kept in a different part of the file, are not read yet.

What matters when you export is that the file itself — not a shared link, not
a screenshot, not a re-compressed copy — still carries that EXIF data. Sharing
or exporting a photograph does not always keep it: Apple's own guide on
[managing location metadata in Photos](https://support.apple.com/guide/personal-safety/manage-location-metadata-in-photos-ips0d7a5df82/web)
describes a Share Sheet setting that can leave it out.

- **iOS.** Apple's guide to [exporting from Photos on Mac](https://support.apple.com/guide/photos/export-photos-videos-slideshows-and-memories-pht6e157c5f/mac)
  covers exporting the unmodified original, which is the version EXIF survives
  in. On an iPhone or iPad directly, Apple documents no separate export
  command — files come out through Share or through a computer, and the
  location-metadata guide above is the one to check either way.
- **Android.** Google's guide to [downloading photos or videos to your device](https://support.google.com/photos/answer/7652919)
  and, for everything at once, [downloading your Google data through Takeout](https://support.google.com/accounts/answer/3024190)
  are the provider's own pages. A camera's own JPEG, copied off the device
  directly (a cable, a file manager), carries its EXIF as written and needs no
  export step at all.

This is exactly what an owner's `/<user>/extract` — this instance's own
guided camera-roll import — turns into a trip draft, off by default until
the `extract` capability is enabled (`lib/capabilities.ts`).

## Location history

Google's Timeline is the record of where a phone has actually been, not just
where a photograph was taken — the two rarely cover the same days. Google's
own guide to [managing your Google Maps Timeline](https://support.google.com/maps/answer/6258979)
covers exporting it, on Android and on iPhone.

This software's own GPS importer reads that export directly —
`importers/gps/google-timeline.ts` parses the flat array of segments Google's
on-device export writes, each with a `timelinePath`, an `activity` leg or a
`visit`; Google's own guessed travel mode is read and dropped, because a guess
about what happened is not something this software repeats as fact. An older
Google Takeout `Records.json` is read too (`importers/gps/google-records.ts`),
for anyone whose export predates the on-device version.

None of it is guessed from the photographs themselves. A location history is
imported over the API (`POST /api/v2/<user>/import`, `kind: "gps"`), goes
straight into `content/<user>/gps/` — never served, never exported, never read
by any route — and only a trip-dated, simplified line derived from it
(`trips/<trip>/track.json`) is ever drawn on a public map. See `docs/gps.md`
for the full shape of that boundary.

## Contacts

A phone's own address book exports as a vCard (`.vcf`) — the format every
contacts app has written since vCard 3.0, and the only one this software
reads (`importers/contacts/vcard.ts`). Apple's guide to
[importing, exporting and printing contacts on iCloud.com](https://support.apple.com/guide/icloud/import-export-and-print-contacts-mmfba748b2/icloud)
and Google's guide to [exporting, backing up or restoring contacts](https://support.google.com/contacts/answer/7199294)
are the provider's own pages for getting one out.

This importer reads a deliberately small slice of it — a name, a first email,
a first phone number — because the reason to import a contact here is a person
picking who, of everybody on their phone, has actually asked this journal for
post. Nothing is written automatically: a contacts export is staged, read
back as a proposed list, and only written after a person agrees it
(`POST /api/v2/<user>/contacts/import` — see `docs/helper.md`).

## Bank statements, for a trip's costs

A bank's export of what actually left an account is the only honest source for
a trip's spending — nobody remembers seventy small payments two months later.
This software currently reads one bank's statement format:
`importers/costs/revolut.ts` parses a Revolut consolidated CSV statement, and
`revolut-account.ts` reads a single-account one. Revolut's own [help centre for viewing account
statements](https://help.revolut.com/en-US/help/exploring-revolut/managing-my-money/viewing-my-account-statements)
is the current, authoritative page for getting one out of the app; this
project's `docs/helper.md` records the specific in-app path a previous export
was followed through, which is worth checking against Revolut's own page if it
looks unfamiliar.

An automatic, no-export connection to a personal Revolut account is tracked as
a future feature (B1581) and does not exist yet — a statement export is the
only route today.

Once you have the file, this software never reads it into a day directly.
`docs/statements.md` is the full shape: the statement is staged, read back as
a report grouped by day and by merchant with real exchange rates computed from
what the bank actually moved, and only after a person agrees the categories,
merchant by merchant, are the rows written into the trip's costs
(`POST /api/v2/<user>/trips/<trip>/costs/apply`). A bank's own category guess
is dropped on the way in — a statement says what was paid, never what it was
for.

Another bank's statement is a different reader over the same shape:
`importers/costs/` is its own registry (`importers/README.md`), and adding one
does not touch the review-and-agree flow behind it.
