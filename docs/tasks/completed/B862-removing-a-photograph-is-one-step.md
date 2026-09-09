---
id: B862
title: Removing a photograph is one step behind where you notice you want to
type: ISSUE
priority: low
complexity: low
area: agent, ui
found: "2026-09-07T17:23:46Z"
started: "2026-09-08T20:28:43Z"
merged: "2026-09-08T20:41:44Z"
completed: "2026-09-09T16:47:11Z"
---

# B862 — Removing a photograph is one step behind where you notice you want to

## Why

The place an owner notices they do not want a photograph is looking at it,
full screen, in the lightbox (`components/Lightbox.tsx`, opened from
`components/Gallery.tsx` on a day). Before this ticket that view offered
nothing but close/prev/next (`components/Lightbox.tsx:89-118` as it stood):
removing the photograph meant closing the viewer, scrolling down to "Correct
this day" (`components/OwnerTools.tsx` → `EditDay`), and finding the *same*
photograph a second time among the thumbnails in `components/EditDay.tsx`
(`day.entries[at].gallery.map(...)`, `components/EditDay.tsx:333`) before
pressing its own "Remove". Three steps and a re-identification for something
the owner had already picked out on screen a moment before — the "one step
behind" of the title.

## Work

`components/Gallery.tsx` gained an optional `onRemove?: (src: string) => void`
prop. When present (owner only — `StoryPager` passes it exactly when
`trip.canPublish`), the open photograph's lightbox now shows a second control
beside Close: a trash icon, `aria-label` from a new locale key
(`a11y.removePhoto`), that calls `onRemove(open.src)` and closes the viewer.
`components/Lightbox.tsx` grew the generic `extra?: ReactNode` slot this
renders through, so `GalleryGrid.tsx` (the trip-wide gallery page, which has
no correction panel behind it and no per-entry mapping) is untouched and
keeps passing nothing.

`components/StoryPager.tsx`'s `DayCard` wires that callback to `setEditing`
and a new `removing` (photograph src) state, threaded through `UpdateBlock`.
`components/EditDay.tsx` grew `initialDrop?: string`, used only to seed the
existing `dropping` state (`useState<string[]>(() => initialDrop ? [initialDrop] : [])`).

**Nothing about the confirm-before-delete flow changed.** Pressing the new
control does not delete anything — it opens the same `EditDay` panel that
"Correct this day" always opened, with the one photograph already shown
dimmed and offering "Keep after all" (the existing `dropping` mechanic).
Nothing leaves disk until the owner presses Save there, exactly as before
B862. This keeps `test/no-browser-dialogs.test.ts` green: no new
confirmation surface was added, the existing panel-based one just became
reachable in one press instead of three.

Not done: the trip-wide gallery page (`GalleryGrid.tsx` / `/trips/<id>/gallery`)
still has no removal path from its own lightbox — its items are pulled from
many different entries across the trip with no single day-panel to route
into, and scoping that is a separate, larger question. Also not done: scrolling
or highlighting the marked tile inside `EditDay` once it opens — the "Keep
after all" label and dimming already make it findable on an ordinary day's
handful of photographs, and a day with enough photographs to need a scroll
target did not turn up in this ticket's Why.

## Acceptance

- A reader who is not this journal's owner opens a day's lightbox and sees no
  removal control. Verified: `test/gallery-owner-remove.test.tsx`,
  "a reader who is not the owner sees no remove control".
- The owner opens the lightbox and finds a control that removes the
  photograph on screen. Verified: `test/gallery-owner-remove.test.tsx`, "the
  owner sees it, and it reports which photograph was on screen" (asserts the
  control is present only when `onRemove` is passed, and that clicking it
  reports the open item's own `src`).
- Nothing is deleted by that one press — it lands the owner on the same
  correction panel as "Correct this day", with the picture already marked and
  reversible. Verified: `test/edit-day-initial-drop.test.tsx`, "the named
  photograph starts marked to go, the other does not" (the panel's initial
  render shows "Keep after all" for the named photograph and still offers
  "Remove" for the other — i.e. nothing has left disk, the mark is just
  pre-set).
- `EditDay` opened the ordinary way (no photograph pre-marked) is unchanged.
  Verified: `test/edit-day-initial-drop.test.tsx`, "with no initialDrop, both
  photos still offer to be removed".
- `GalleryGrid` (the trip-wide gallery) renders no new control and is
  unaffected — it never passes `onRemove` to `Gallery`, and does not use
  `Gallery` at all (it uses `Lightbox` directly with no `extra`). Checked by
  reading `components/GalleryGrid.tsx`; not separately tested because it is
  an absence, not a behaviour, and no test in this repo currently exercises
  that file's lightbox chrome.
- Eyeball-only, not checkable by these tests: how the trash icon actually
  looks beside Close on a phone-width screen, and whether pressing it and
  landing on a pre-marked correction panel reads as expected in a real
  browser. Not driven in this pass — see the note about `test-in-a-browser`
  below if that matters before this leaves `testing/`.
- `npm run verify` passes in full (build, tsc, eslint, 447 test files /
  5774 tests, knip) — run in this worktree on 2026-09-08.

Not yet checked in a real browser: this pass added and ran unit tests
(`vitest`) only, per the dispatch instructions for this ticket. Anyone moving
this to `completed/` should still open a day with an owner session at 390px
(the `test-in-a-browser` skill) and look at the icon.
