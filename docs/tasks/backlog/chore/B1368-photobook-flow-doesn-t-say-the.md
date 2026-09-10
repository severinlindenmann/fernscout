---
id: B1368
title: Photobook flow doesn't say the print is experimental
type: CHORE
priority: low
complexity: low
area: photobook
found: "2026-09-10T18:31:58Z"
---

# B1368 — Photobook flow doesn't say the print is experimental

## Why

Nobody has ever seen a Fernscout photobook actually printed. The owner is
about to order one real copy to check it, and only in the format they pick
first — every other size/cover combination in `lib/photobook/spec.ts`
(`BOOK_SIZES`, soft/hard cover) is still unverified against what Gelato
actually delivers. Nothing on the photobook pages says this: an owner who
finds the feature, sets up a book and pays for one has no way to know the
print quality, trim, or binding for their chosen format has not been checked
against a real, physical copy — only that the digital preview and the PDF
pipeline work.

## Why worth a disclaimer rather than silence

Getting a plausibly-wrong book is exactly the kind of surprise this project
avoids elsewhere by being upfront (`test: true`'s own banner is the existing
pattern — `site/locales/de.json:1211-1212`, "Testinhalt — das ist kein echter
Tag"). Same shape here: say it is unproven, so a surprise is not one.

## Work

Add a small "Experimental" notice, in the same visual register as the
`test:` content banner, to the photobook flow — at minimum on
`app/[user]/trips/[trip]/photobook/page.tsx` / `PhotobookPageContent.tsx`
(near the `<h1>{tripTitle}</h1>` around line 581-583) so it is seen before
any setup begins, and again near the Pay button in `BookLevelView.tsx`
(~line 421-428, beside the price) so it is the last thing seen before
spending credits — the two places money and expectations meet.

Write real text in `en.json`, `de.json` and `hu.json` (a locale key, not a
hardcoded string — see "A new string in the UI is three files and a script"
in AGENTS.md, and run `npm run i18n:keys` after adding it), saying plainly:
the printed book has not been checked in every size/cover combination yet,
only one real copy is being test-printed to start, and what a person should
therefore expect — a photo book that works, whose real-world print quality in
their chosen format is not yet confirmed. No overclaiming that it might be
wrong, and no underclaiming that it definitely is; honest and short, like the
`test:` banner.

Not touching: the ordering flow's mechanics, pricing, or which formats are
offered — this is a notice, not a feature gate. Whether to also mail this
caveat with the receipt is out of scope; capture separately if wanted.

## Acceptance

A person opening the photobook page for a trip sees an "experimental print"
notice before setting up a book, and again beside the Pay button before
paying, in their own language (en/de/hu, none of them a placeholder copy of
another locale). `npm run verify` passes.
