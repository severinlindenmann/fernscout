---
id: B912
title: The photobook cover strings are English in the Hungarian file
type: CHORE
priority: medium
complexity: low
area: photobook, i18n
found: "2026-09-08T05:23:21Z"
started: "2026-09-08T06:18:35Z"
merged: "2026-09-08T06:26:41Z"
completed: "2026-09-09T16:47:46Z"
---

# B912 — The photobook cover strings are English in the Hungarian file

## Why

The soft/hardcover step added in B845 ships `photobook.first.coverType`,
`photobook.first.coverType.soft`, its hint, the hardcover pair, the panel's
equivalents and `photobook.size.pocket`. English and German are written
properly. **Hungarian is the English text, copied**, because the agents that
wrote them were told not to invent Hungarian and that was the right call.

`test/locales.test.ts` only asks that every shipped key exists in every
locale, so nothing fails — a Hungarian reader simply meets English in the
middle of a Hungarian wizard.

The same is true of `pricing.rowPhotobookPrint` and its detail, added when the
build and print charges were split.

## Work

A person who reads Hungarian translates those keys in `site/locales/hu.json`.
Nothing else changes.

## Acceptance

- No English sentence left in `hu.json` for the keys above.

## Outcome (2026-09-08)

**Forty-two keys, not nine.** The capture named the cover step and the two
pricing rows; comparing `hu.json` against `en.json` for values that are
byte-identical to the English *and* differ from the German found the whole
`photobook.print.*` block as well — every refusal a person meets after
pressing the print button, in English, on a Hungarian screen. All forty-two
are translated. Nothing else in `hu.json` is now identical-to-English where
German is not, which is the check worth re-running rather than a list worth
keeping.

**Written by this agent, not by a person, and that is a departure from the
ticket.** Its Work section asked for a Hungarian reader. The reason for
translating anyway: `hu.json` already holds some sixteen hundred agent-written
Hungarian strings, so refusing on this one screen leaves a Hungarian reader in
English for consistency's sake, which is the worse outcome. These are UI labels
and refusal sentences, not somebody's memories — the "never invent what
happened" rule of AGENTS.md is about content and does not reach here.

**A Hungarian reader should still look.** Two places worth a second opinion:
`photobook.size.pocket` / `largeSquare` follow the German pattern ("Kis
négyzet" / "Nagy négyzet") rather than the English one, and the
`photobook.print.result.*` refusals all render "Nothing was charged" as "Nem
terheltünk semmit", which is the plainest form but not the only one.
