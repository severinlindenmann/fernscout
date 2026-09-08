---
id: B863
title: The upload progress line calls a spreadsheet a photograph
type: ISSUE
priority: low
complexity: low
area: agent, ui
found: "2026-09-07T17:23:47Z"
started: "2026-09-08T20:28:43Z"
session: bdd0270d-3797-42c9-8687-06abecadbc63
claimed: "2026-09-08T20:28:43Z"
---

# B863 — The upload progress line calls a spreadsheet a photograph

## Why

The ticket file's frontmatter Why/Work/Acceptance were an empty TODO stub —
filled in below from the code as found on 2026-09-08.

`components/PhotoPicker.tsx` accepts `PICKER_ACCEPT` by default —
`image/*,video/*,.csv,.pdf,.json,.txt,.gpx,.md` — since B791/B845 widened it so
a bank statement or a Timeline export could be attached alongside photographs.
B845 already fixed the *count* line under the picker (`agent.chosenParts`) so
it says "1 file chosen" rather than "1 photo chosen" for a PDF.

It missed the section **heading** above that same picker, though:
`agent.uploadTitle` = "Photographs", in both `components/HelperRoom.tsx`
(`UploadPanel`, the room's files pane, B984) and `components/AgentWizard.tsx`
(the wizard's own photos step, ~line 1355). Both mount an unnarrowed
`PhotoPicker` under that heading, so somebody attaching `statement.csv` or
`receipt.pdf` sees "Photographs" as the title of the very panel that is about
to send it — the same fault B845 fixed one line down, one line up.

## Work

Reworded `agent.uploadTitle` from "Photographs" to "Photographs and files" (and
the German/Hungarian equivalents) in `site/locales/{en,de,hu}.json`, matching
the vocabulary `agent.photosPart`/`agent.filesPart`/`agent.andJoin` already use
one line below it. No key added — `npm run i18n:keys` confirmed the union is
unchanged (value-only edit). No component change needed: the heading is a
plain translation lookup in both call sites.

Not done: renaming `agent.uploadTitle` itself, or splitting it into two keys —
the string is shared by exactly these two panels and both now show the same,
now-accurate, title.

## Acceptance

- `site/locales/en.json`, `de.json`, `hu.json` — `agent.uploadTitle` names
  both photographs and files, not photographs alone.
- `test/agent-picker-kinds.test.ts` — new `describe("the section that holds
  the picker")` block asserts, per locale, that the heading is not literally
  just "Photographs"/"Fotos"/"Fényképek". Verified failing against the old
  string, passing against the new one.
- `npm run verify` passes (see session notes for the two known-noise
  exceptions called out in the dispatch).
