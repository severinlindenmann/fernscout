---
id: B1834
title: The transcript says tap to correct but only the flagged word is tappable, and nothing at all when none was flagged
type: ISSUE
priority: high
complexity: low
area: extract, check the wording
found: "2026-09-17T05:12:00Z"
started: "2026-09-17T05:12:19Z"
session: 0e7f2abd-d7ef-4dd2-9733-1fd412b78b47
claimed: "2026-09-17T05:12:19Z"
---

# B1834 — The transcript says tap to correct but only the flagged word is tappable, and nothing at all when none was flagged

## Why

Reported from a real handset, in German, on the live site: *"when i press, why
cant i edit the text?"*

`components/extract/CheckWording.tsx` renders the card label
`extract.checkWording.heardLabel` — "Was wir gehört haben — zum Korrigieren
antippen" / "What we heard — tap to fix" — **unconditionally**, above a
transcript where the only tappable thing is the single word the provider
measured low confidence on. Everything else is a plain `<p>`.

Two failures, and the reporter hit the worse one:

1. **No flagged word means nothing is tappable at all.** `splitOnWord` returns
   `null` when there is no uncertain word, and the component then renders the
   bare `text`. The label still says tap to correct. The "Ein Wort war
   unsicher" panel is correctly hidden in this case — it is gated on `split` —
   so the screen is a label promising an edit, over text that does nothing.
   The reporter's own message quoted the label and no panel, which is this
   state exactly.
2. **Even with a flagged word, only that one word can be fixed.** Transcription
   mishears more than one word at a time, and the person cannot touch any of
   the others. The flagged word is a hint about where to look, and it was built
   as though it were the only thing that could be wrong.

The screen exists to stop a misheard place name reaching a published sentence.
A person who can see the error and cannot correct it is worse served than by a
plain text box, because the screen has told them the correction is available.

## Work

Make the whole transcript editable, and keep the highlight as what it is — a
hint about where the provider was least sure, not the limit of what may be
changed.

Tapping anywhere in the transcript opens the full text for editing (a native
`textarea`; never `window.prompt`, AGENTS.md forbids it). The flagged word stays
visually picked out in the resting state so the eye goes there first. Keep
returning the edited text from "Looks right — keep going", as it already does.

Check the label against both states once the fix is in: it should be true when
a word is flagged and true when none is.

## Acceptance

- With no flagged word, tapping the transcript opens it for editing, and the
  edited text is what "Looks right — keep going" hands back.
- With a flagged word, the same is true, and the flagged word is still visibly
  picked out before the tap.
- A word the provider did NOT flag can be corrected.
- Verified in a browser at 390px, both themes, against a real recording — the
  reported case is a German recording with no low-confidence word.
