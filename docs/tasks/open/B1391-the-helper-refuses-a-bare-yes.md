---
id: B1391
title: "The helper refuses a bare yes to its own delete question, and an inbox cannot be emptied at all"
type: ISSUE
priority: high
complexity: medium
area: the web helper
found: "2026-09-10T19:55:00Z"
---

# B1391 — The helper refuses a bare yes to its own delete question, and an inbox cannot be emptied at all

## Why

Observed in the room, in German. The helper listed the inbox itself and asked
the question:

> **Im Eingang wartend** — `44f9…mov` — photograph, 2 MB · `f87…jpeg` —
> photograph, 542 KB
> *Deine Inbox hat zwei Dateien … Soll ich alle beide löschen, oder möchtest du
> die noch irgendwo anbringen?*
>
> **Du:** löschen
>
> *Löschen kann dieses Gespräch nicht, und es hat sich nichts geändert. Ein
> ganzes Journal, das weg soll, endet in deinem Postfach …*

The helper asked, was answered, and then told the person it cannot do the thing
it had just offered to do. The paragraph about mailboxes and trip pages is
correct about journals and trips and has nothing to do with two staged files.

**It is not the model.** That text is `agent.askRefuseRemove`
(`site/locales/de.json:1514`), fired by the `remove` refusal in
`lib/helper/intents.ts:125-161` before the model sees the turn. Three separate
faults meet on that one line:

1. **The refusal reads one message, and the noun was in the previous one.**
   The regex is
   `^(?=…DESTROY)(?:(?!…REMOVABLE)|(?=…KEPT))` — a destruction word, then
   refused unless the *same sentence* names something removable. `"löschen"`
   carries `lösch` and no noun, so it is refused. The noun was in the helper's
   own question one line above. Every natural confirmation — *löschen*, *ja,
   lösch sie*, *delete them*, *igen, töröld* — fails the same way, and the
   comment at `:142-148` shows the case was reasoned about only for sentences
   that stand alone.
2. **"Alle" is in `KEPT`.** `\balles?\b`, `\ball\b`, `mindent` (`:123`) exist
   so *"delete everything"* is refused. They also refuse *"lösche alle Dateien
   in meiner Inbox"* — a sentence that names files, means files, and is the
   plainest way to ask for this. So even the fully-spelled-out request is
   turned down.
3. **There is no bulk anything.** `discard_file`
   (`lib/helper/tools/areas/files.ts:290`) takes one `file` id. *Leere meine
   Inbox* has no tool behind it: with two files it is two proposals and two
   presses, with twenty it is unusable.

Everything under those three is already built and works. `POST
/api/helper/<user>/inbox/discard` exists for the cookie-holding browser,
`removeInboxFile` in `lib/inbox.ts` knows what "gone" means for a file and its
sidecar, `HelperRoom.tsx:2177` already opens the proposal from the file's own
menu, and `decisionKind` in `components/HelperAsk.tsx:238` already classifies
`discard_*` as `"destroy"` and draws it with the 🗑️ card. The capability is
whole; the sentence cannot reach it.

**What it costs.** Inbox files are the one thing here that is genuinely
throwaway — bytes staged for a day, never on the site, never read by anybody.
Being unable to clear them is how an inbox becomes a junk drawer that counts
against the 5 GB journal ceiling (`lib/storageQuota.ts`). And the person is not
told "I can't do that yet": they are handed a confident paragraph about
mailboxes, which is the misleading-sentence failure `lib/helper/model.ts`'s net
exists to prevent, arriving from the pre-filter where the net cannot see it.

## Work

**The asked-for shape: press, then be asked once more, in the page.** Two
presses for anything destructive — the proposal card's own button, then a
`components/ConfirmPanel.tsx` naming exactly what goes. Never `window.confirm`
— B633/B668, and `test/no-browser-dialogs.test.ts` fails on it.

- **Second press on destroy-class proposals.** `decisionKind(tool) ===
  "destroy"` already names the set (`revoke_key`, `discard_file`,
  `unpublish_day`, and anything named the same way later), so this is one
  branch in `HelperAsk`'s accept path, not a table to keep in step. The panel
  states the inventory in words — *2 Dateien, 2,5 MB, endgültig* — the way the
  trip delete page does. `unpublish_day` is arguably not destruction at all
  (nothing is lost); decide whether it takes the second press or stays at one,
  and say which in the code.
- **A bulk discard.** Either `discard_file` accepting several ids, or a
  sibling `empty_inbox`. Prefer the first — one tool, one confirm panel
  listing every filename — and let the existing route take an array. Do not
  add a second endpoint if the one there can carry it.
- **Teach the pre-filter the turn, not more words.** A bare *löschen* answering
  the helper's own delete question must pass. The lazy version is what the
  refusal is missing: it is handed one message and no context, so give it the
  turn — if the preceding assistant message proposed a removable thing, a bare
  confirmation is that confirmation. Adding *löschen* to a word list does not
  fix it, because the next person says *ja, mach weg*. Whatever passes still
  reaches a model that has no tool for a day, a trip or a journal, which is the
  standing floor (`:149-153`).
- **Take `all`/`alles`/`mindent` out of `KEPT` only when the sentence also
  names something removable.** *"Lösche alles"* stays refused; *"lösche alle
  Dateien"* must not be. The `KEPT` list keeps doing its job for days, trips,
  journals and accounts.
- Refusal copy: whatever survives should not describe the journal-by-mailbox
  route when the person asked about files. Three languages, real German and
  real Hungarian, plus `npm run i18n:keys`.

**Not in this ticket, and the line must not move.** Nothing here gives the
helper a way to delete a **day**, a **trip** or a **journal**. A journal still
ends in the owner's mailbox (`lib/deletions.ts`, B38) and a trip on its own page
behind a browser cookie (B1321). This is inbox bytes and the existing
destroy-class tools, and the point of the second press is to make those safe to
reach, never to widen what can be reached.

## Acceptance

- In the room, with two files staged: *leere meine Inbox* → one proposal
  naming both files → press → a confirm panel naming both → press → both gone,
  and the helper says so. Driven in a browser (`test-in-a-browser`), because
  the acceptance is what somebody sees.
- Replying *löschen* to the helper's own *"Soll ich alle beide löschen?"*
  reaches the proposal instead of `agent.askRefuseRemove`. The same for
  *delete them* and *igen, töröld*.
- *lösche alle Dateien* proposes; *lösche alles*, *lösche den Tag mit dem Foto
  von Anna*, *delete my trip* and *delete my journal* are all still refused.
  These belong in `test/helper-intents.test.ts` (or wherever the `remove` row
  is covered today) as the regression fence.
- No new `confirm()`/`alert()` — `npx vitest run test/no-browser-dialogs.test.ts`.
- `npm run verify` clean.
