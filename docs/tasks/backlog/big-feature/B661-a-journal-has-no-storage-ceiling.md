---
id: B661
title: A journal has no storage ceiling it can see, reach or raise
type: FEATURE
priority: high
complexity: high
area: media, credits, config, mail
found: "2026-09-07T06:44:28Z"
---

# B661 — A journal has no storage ceiling it can see, reach or raise

## Why

A journal on a shared instance can grow until the VPS disk is full, and
nobody involved finds out until it is. Three separate gaps.

**The ceiling is off, and it only guards one door.** `perUserBytes` in
`lib/mediaLimits.ts` defaults to `null` — no limit — and `site/config.json`
sets no `media` block at all, so fernscout.ch has no ceiling today. Where it
is set, `lib/api/media.ts:274` is the only thing that enforces it, and it
counts only `media/` and the originals of every trip
(`journalMediaBytes`, `lib/api/media.ts:90`). Everything else that lands
under `content/<user>/` is free: photobook PDFs (tens to hundreds of MB each
— B483 prunes them by *count*, not by bytes), generated postcards, and
markdown. What a person pays for is the folder, so the folder is what should
be counted.

**Nobody is told.** There is no mail on the way to full and none on
arriving. The one place the bytes are already counted for a human is the
operator's status mail (`bytes` in `JournalRow`, `lib/statusReport.ts:47`) —
that is the operator, not the owner, and it is a nightly digest rather than a
warning.

**A full journal is a dead end.** The refusal from `lib/api/media.ts` names
the number and offers nothing. On an instance that already has credits and a
purchase flow (`lib/credits/pricing.ts`, `lib/credits.ts` `grant`/`spend`),
the owner has no way to buy the room they have just been refused.

Cost of leaving it: the failure mode is a full disk on the VPS, which takes
down every journal on it, and the first symptom is somebody else's upload
failing.

## Work

**A quota over the whole journal folder, not over media.** Count
`content/<username>/` — one walk, `dirBytes` in `lib/statusReport.ts:69` and
`journalMediaBytes` in `lib/api/media.ts:90` are the same walk written twice
and should become one shared helper. Walked, not tracked in a counter, for
the reason both files already give: the content is a folder somebody owns and
edits by hand. Default it to 5 GB in `DEFAULT_MEDIA_LIMITS` — the current
`null` stays parseable so an instance can opt out, but shipped-off is what
put us here.

**Enforce it at every write into `content/<user>/`, not just uploads.** Find
them: media upload, `lib/api/fetchMedia.ts`, photobook and postcard
generation, day and trip writes. One guard function that all of them call —
one `over quota` check in the shared helper is a smaller diff than a check in
each caller, and a path nobody updated is a path that walks past the ceiling.
Refuse with a problem that names bytes held, the ceiling, and how to raise
it.

**Mail the owner at low and at full.** Low is a threshold (90% is the
starting proposal) and each notice fires once per crossing, not per upload —
whatever holds that state, it is not a file under `content/`. `lib/mail`
already has the transport, the templates and the file backend, so nothing
here needs a paid account to build or test.

**Sell 5 GB more, once, for 50 credits.** 50 credits is CHF 10.00 at the base
tier and is already a tier id in `TIERS` (`lib/credits/pricing.ts:28`), so
the money is arithmetic that exists. Lifetime, repeatable, additive: each
purchase spends 50 credits via `spend()` and raises this journal's ceiling by
5 GB permanently. The extra bytes are journal state and belong beside the
balance in the database, not in a config file a `git pull` overwrites — and
they must be a **grant on top of** `perUserBytes` rather than a rewrite of
it, so the server's ceiling still means something (`narrowest()` composes the
two levels today and must keep composing).

**Not doing:** subscriptions or recurring billing — a one-time lifetime
purchase only, said out loud so the schema is not designed around a renewal
nobody is building. Not touching the per-file and per-day limits, which
already work. Not counting the database, mail (`<dataDir>/mail/`, outside
`content/` since B636) or anything outside the journal folder.

Contract: a new or changed route goes in `lib/api/openapi.ts`, and the
journal's held bytes and its ceiling must be readable back — `/api/v1/<user>/status`
is where an agent would look before an upload, and `/api/health` is where a
limit belongs so a caller reads it before hitting it.

## Acceptance

- With a 5 GB default and a journal holding more, every write path into
  `content/<user>/` refuses, naming held bytes, the ceiling and the remedy.
  A test asserts a *non-media* write (a photobook) is refused too.
- `GET /api/v1/<user>/status` reports bytes held and bytes allowed; both are
  in `lib/api/openapi.ts`, and `npm run verify` passes.
- Crossing 90%, and then reaching full, each writes one mail into
  `<dataDir>/mail/<user>/`; a second upload past the same threshold writes
  none.
- Buying the extension spends 50 credits and raises this journal's ceiling by
  5 GB; buying twice raises it by 10 GB; a balance under 50 refuses and
  spends nothing.
- The server's `media.perUserBytes` ceiling still narrows a user config that
  asks for more, with purchased bytes on top.
