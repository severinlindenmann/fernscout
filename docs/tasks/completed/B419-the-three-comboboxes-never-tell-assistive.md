---
id: B419
title: The three comboboxes never tell assistive tech which suggestion the arrow keys are on
type: ISSUE
priority: low
complexity: low
area: contacts, accessibility
found: "2026-09-05T10:45:00Z"
started: "2026-09-07T10:37:35Z"
merged: "2026-09-07T10:55:58Z"
completed: "2026-09-07T13:10:22Z"
---

# B419 — The three comboboxes never tell assistive tech which suggestion the arrow keys are on

## Why

Three controls now share one pattern, all built in the last day:
`components/TelField.tsx` (B390), `components/CountryField.tsx` (B398) and
`components/AddressLookupField.tsx` (B399). Each is an `input[role=combobox]`
over a `ul[role=listbox]`, and each moves a highlight with the arrow keys.

None of them sets `aria-activedescendant`. The highlight is carried by
`aria-selected` on the option plus a visual style — found while fixing B416's
`aria-hidden`, and confirmed in `AddressLookupField` by the agent that built
it.

For a sighted person that works. For somebody on a screen reader, focus never
leaves the text input, so nothing announces which option the arrow keys have
landed on: they hear the list open, press Down, and are told nothing until
Enter has already chosen something. `aria-selected` alone does not move the
reader's attention — `aria-activedescendant` is the attribute that says "this
is the option you are on now" while focus stays in the box.

It is the same defect three times because it is the same pattern three times,
which is also why it is cheap: the fix is one attribute on the input and one
id per option, in a pattern the three already share.

## Work

Give every option a stable id, and set `aria-activedescendant` on the input to
the highlighted option's id (absent when nothing is highlighted). Keep
`aria-selected` — it says which one is chosen, a different question from which
one the keys are on.

Consider whether the three should share one component rather than one
pattern. That is the reason this is not three tickets, and it is the answer if
a fourth combobox is coming; it is not obviously worth it for three that
already exist and work.

Related: B391 — none of this is machine-tested, because the checkout has no
DOM environment for vitest. Whoever fixes that first makes this one provable.

## Acceptance

In all three controls, arrowing through the list moves `aria-activedescendant`
on the input to the highlighted option's id, and clearing the highlight
removes it. Verified in a browser with VoiceOver or equivalent announcing each
option as it is reached — this one cannot be closed by a unit test until B391
lands.

## Triage

Confirmed against current code: `CountryField.tsx` and `TelField.tsx` both
already set `aria-activedescendant={open && active ? \`${listId}-${…}\` :
undefined}` with a stable `id={\`${listId}-${…}\`}` on each option.
`AddressLookupField.tsx` had neither — options had no `id` at all, and the
input carried `aria-expanded`/`aria-controls`/`aria-autocomplete` but no
`aria-activedescendant`.

Fixed in `components/AddressLookupField.tsx`: each `<li role="option">` now
gets `id={\`${listId}-${i}\`}`, and the input gets
`aria-activedescendant={enabled && showList ? \`${listId}-${highlight}\` :
undefined}` — absent whenever the list isn't shown (disabled, closed, or no
suggestions), present and pointing at the highlighted row otherwise, matching
the other two fields' pattern exactly.

**B391 has landed since this ticket was filed** (jsdom is available per-file
via `// @vitest-environment jsdom`, see `test/photobook-persistence.test.tsx`
for precedent), so this is closable by a unit test after all, ahead of the
"needs a browser" caveat the ticket was filed with.

Test: `test/address-lookup-field-a11y.test.tsx` (new) — mounts the real
component in jsdom via `createRoot`/`act`, stubs `fetch`, types a query,
and asserts `aria-activedescendant` points at the first option's id before
any key is pressed, moves to the second option's id after `ArrowDown`, and is
absent entirely when the field is disabled. Confirmed it fails without the
component change (stashed and reran) and passes with it. A VoiceOver pass is
still worth doing before this is fully closed in a browser, but the
mechanical half — the attribute tracking the highlight — is now pinned.
