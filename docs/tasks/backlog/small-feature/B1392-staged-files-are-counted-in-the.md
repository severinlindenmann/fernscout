---
id: B1392
title: "Staged files are counted in the storage card and on /agent, and neither offers a way to clear them"
type: FEATURE
priority: high
complexity: low
area: the owner's account page, the web helper
found: "2026-09-10T20:05:00Z"
---

# B1392 — Staged files are counted in the storage card and on /agent, and neither offers a way to clear them

## Why

On `/<user>/account` the Speicherplatz card names the inbox as a share of the
journal's 5 GB — *Staged files, 3 MB*, a row of its own in the legend beside
the trips. It is the only row on that card a person can act on, and it is the
one row with no control beside it. Live example: two files staged (a 2 MB
`.mov` and a 542 KB `.jpeg`), 3 MB on the bar, nothing on the page that removes
them.

**The cleanup button that looks like the answer is not.** `CleanupButton`
exists (`AccountPageContent.tsx:210`), asks properly in the page with
`ConfirmPanel`, and even carries a *"also remove the documents staged in my
inbox"* checkbox. But:

- It is gated on `storage.reclaimable.files > 0` (`:774`, `:777`), and
  `computePlan` in `lib/storageCleanup.ts:116` counts only
  `listInbox(username).files` — the `inbox/files/` subfolder — alongside
  printed photobooks and postcards.
- The legend row counts `dirBytes(inbox)` — **the whole inbox**
  (`lib/storageQuota.ts:130`), photographs and videos included.

So a journal whose inbox is entirely photographs (the ordinary case, and the
case in the screenshot) shows 3 MB on the bar and no button at all. The number
says *here is something you could clear* and the page offers nothing that
clears it.

`storageCleanup.ts:38-40` is honest about the intended route — staged
photographs "are removed one at a time through `DELETE
/api/v1/<user>/inbox/<id>`, where a person is looking at what they are
removing" — but **there is no page where a person is looking at them.** The
account page never lists them. The only place they are visible is the helper
room's file pane, and reaching them by sentence there is broken for a separate
reason (B1391).

Same gap on `/agent`: the left pane carries **FOTOS UND DATEIEN** with
*Dateien wählen*, then a **SPEICHER** line — *0.08 GB von 5.0 GB*,
`HelperRoom.tsx:2001-2025` — which is a link to the account page and nothing
else. The pane that stages files has no way to unstage them in bulk.

Small thing, same card, worth fixing while there: *Staged files* and
*Everything else* are hardcoded English (`lib/storageQuota.ts:130` and its
neighbour) and render untranslated in a German UI, next to *Algarve 2026* and
*Elsass 2025*, which are real names. Every other string on the page goes
through `t()`.

## Work

**The account page.** In the Speicherplatz card, make the inbox row actionable:
show how much is staged and how many files, and offer to clear it.

- Press → `ConfirmPanel` naming what goes — the count, the size, and that it is
  final — then a second press deletes. This is the shape the page already uses
  for buying storage and for cleanup, and never `window.confirm` (B633/B668).
- Prefer listing the files in the panel over a bare count if it is cheap:
  filename, kind and size are already in the inbox sidecars, and it is what
  makes `storageCleanup.ts`'s "a person is looking at what they are removing"
  actually true.
- Reuse `removeInboxFile` — it is the one function that knows a file and its
  sidecar move together. Whether this rides on `POST
  …/storage/cleanup?staged=1` (widened to cover `inbox/media/`) or gets its own
  small route is the builder's call; if it widens the existing one, the
  checkbox copy `me.storageCleanupStaged` must stop promising *"staged
  photographs are kept either way"*, because it would no longer be true.
- Whatever ships, `reclaimable.files > 0` must stop hiding the control on a
  journal whose only reclaimable thing is staged photographs.

**The helper room.** Under the SPEICHER line in the files pane, add a clear-inbox
option — visible only with something staged, showing the count and size, and
going through the same two presses. `discard_file` and its proposal card
already exist (`lib/helper/tools/areas/files.ts:290`), and `HelperRoom.tsx:2177`
already opens it from a single file's menu; the bulk version is B1391's Work.
Build this on whatever that ticket lands, rather than a second mechanism beside
it.

**Ordering with B1391.** B1391 makes *asking* for it work; this makes *pressing*
for it work, in the two places the number is shown. They share the bulk-discard
call and the confirm panel — build B1391 first, or build them together.

**Not in this ticket.** No change to what the quota counts, no change to
photobook or postcard sweeping, and nothing here touches a day, a trip or a
journal — inbox bytes only, which have never been on the site and which nobody
has read.

## Acceptance

- With two photographs staged and nothing else reclaimable, `/<user>/account`
  shows the staged size and a control that clears it — the case that shows
  3 MB and no button today.
- Press → panel naming the files (or count and size) → press → the files are
  gone, the bar redraws, the row falls to zero. In a browser at 390px and at
  desktop width (`test-in-a-browser`), because the acceptance is what somebody
  sees.
- `/agent` with files staged offers the same under SPEICHER, and reaches zero
  the same way.
- The legend labels are translated in German and Hungarian.
- No `confirm()`/`alert()` — `npx vitest run test/no-browser-dialogs.test.ts`.
- `npm run verify` clean, `test/locales.test.ts` included.
