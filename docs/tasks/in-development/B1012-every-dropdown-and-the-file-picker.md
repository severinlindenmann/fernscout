---
id: B1012
title: Every dropdown and the file picker are the operating system's, in the operating system's type
type: FEATURE
priority: medium
complexity: medium
area: components/, app/globals.css
found: "2026-09-08T19:02:00Z"
started: "2026-09-08T18:45:01Z"
session: 79cece02-4661-45ef-809b-52b592e67f95
claimed: "2026-09-08T18:45:01Z"
---

# B1012 — Every dropdown and the file picker are the operating system's, in the operating system's type

## Why

Twenty-four `<select>` elements across `app/` and `components/`, and not one of
them sets `appearance`. Every one of them therefore draws the operating
system's chevron, at the operating system's size, in the operating system's
grey — on a page that has gone to some trouble to look like somebody's travel
journal. The open list is worse and is what a person actually reported: a
square-cornered macOS popup with a blue selection bar and a tick, over cream.

This is the same argument `AGENTS.md` already makes about `window.confirm` —
a control that arrives in the OS's own chrome is a control that has stopped
belonging to the page — and it is the reason `PhotoPicker` exists at all
(B768). The pattern simply never reached the dropdowns.

There is no shared select anywhere: every call site is hand-rolled Tailwind or
a per-file `FIELD` constant, and `app/globals.css` has no rule touching
`select`, `option` or `::picker`.

The file picker has the same fault in one place. `components/EditDay.tsx:411`
draws a bare `<input type="file">` — the browser's own "Choose files / No file
chosen", in the browser's locale, from strings no CSS can reach. That is
exactly the sentence B768 wrote `PhotoPicker` to stop rendering, and B980 added
this input without reaching for it. `PhotoPicker` is the fix; nothing new is
needed.

## Work

**One CSS block, not twenty-four class strings.** The per-site classes already
carry border, radius and size, and they differ on purpose (`text-sm` in the
photobook panel, `text-lg` on the contacts page). What is missing is uniform:
appearance, our own chevron, and the room to put it. So it goes in
`app/globals.css` as a base `select` rule, unlayered so it beats Tailwind's
`px-*` on padding-right, and every call site is left alone.

Then, additively, the open list where the browser can do it:

```css
@supports (appearance: base-select) {
  select, ::picker(select) { appearance: base-select; }
  /* the popup, in our own palette */
}
```

`appearance: base-select` is stable in Chrome and Edge from 135; Safari has it
in Technology Preview and it is announced for 27; Firefox is prototyping it
behind a flag. It is not Baseline — which is why it is behind `@supports` and
why the base rule above has to stand on its own. A browser that does not know
the property renders the ordinary native popup, which is what everybody gets
today.

**No custom listbox, and this is a decision rather than laziness.** A
`<button>`-plus-popover widget would style the list in every browser and would
cost the keyboard behaviour, the accessibility tree and the typeahead that come
free with `<select>` — for readers past sixty, on phones, outdoors, which is
who `AGENTS.md` says the type ramp is tuned for. On touch, iOS and Android
render a native wheel or sheet that is *better* than anything we would build.
Replacing that is a downgrade dressed as a fix.

**The file input:** `EditDay` renders `<PhotoPicker>`. It needs an optional
`accept` so `EditDay` can stay `image/*,video/*` while the wizard and the room
keep `PICKER_ACCEPT`; the "goes to the inbox" note falls away on its own,
because `countKinds` counts zero non-photographs when nothing else is
accepted.

Not doing: the sizing inconsistency between call sites (`text-sm` / `text-base`
/ `text-lg` for the same control on different pages). It is real and it is a
separate decision about the forms, not about the chrome.

## Acceptance

- Every `<select>` on the site draws Fernscout's chevron, not the OS's, at
  every width — checked at 390px on a day card, `/[user]/me`, the contacts page
  and the photobook settings panel.
- In a browser with `appearance: base-select`, the open list is on cream with
  the brand's own selected state; in one without, it is the native popup and
  nothing is broken.
- `components/EditDay.tsx` contains no `<input type="file">`, and its "add
  pictures" control says Fernscout's words in the reader's language.
- No `select` loses its keyboard behaviour: arrow keys, typeahead and Escape
  all still work.
- `npm run verify` clean.
