---
id: B813
title: A denied microphone is announced politely instead of as a problem
type: ISSUE
priority: low
complexity: low
area: agent, a11y
found: "2026-09-07T15:23:19Z"
started: "2026-09-08T20:36:48Z"
merged: "2026-09-08T20:47:12Z"
completed: "2026-09-09T16:47:02Z"
---

# B813 — A denied microphone is announced politely instead of as a problem

## Why

`RecordButton.tsx` is the one place `getUserMedia` is ever called in this
codebase, so it is the one place a denied microphone is ever reported. The
copy itself was already right — `agent.speechDenied` says what happened
("The microphone was not given") and leaves a way forward ("Allow it in your
browser's settings, or type instead"), honestly pointing at the browser's own
control rather than implying the page can re-request the permission.

The bug was in how it reached a screen reader. The error line rendered with
`role="status"`:

```tsx
const failed = error && (
  <p role="status" className="mt-2 text-sm text-coral-600">
    {error}
  </p>
);
```

`role="status"` is implicitly `aria-live="polite"` — the same priority this
component already uses, correctly, for "recording started" / "recording
stopped" (the `announced` state, rendered permanently as an sr-only
`role="status"` region so a screen reader has something to watch before the
text ever changes). A denied microphone is not a status update, though — it
is the one thing that stops the control from doing anything at all, on a page
whose only other way in is typing. Every other error line in this codebase
uses `role="alert"` for exactly that reason (B796 gave `AgentWizard.tsx` this
same fix for a different silent error; `ConfirmPanel`, `SignupWizard`,
`DeleteConfirm`, `AgentHandover`, `DayCosts` and a dozen others all agree).
`RecordButton.tsx` was the one holdout that never got it, so its own denial —
and its "browser cannot record" and "too short to send" siblings, which share
the same paragraph — could be seen by a sighted reader and missed entirely by
someone using a screen reader, especially since the paragraph is not even
mounted until the error exists (a live region announcing its *own arrival*
is exactly the case `role="status"` is least reliable for).

## Work

- Changed the one `<p role="status" …>{error}</p>` in `RecordButton.tsx`
  (the `failed` block, ~line 539) to `role="alert"`. This is the single
  shared component behind the wizard's hold-to-talk bar, the ask box's
  compact icon, and the search page's compact icon, so the fix covers every
  place a denied microphone is reported without touching three files.
- Did not touch `SearchBox.tsx`'s separate `voiceError` state (its own
  `role="status"` error paragraph, lines ~398/420) — that is a different
  mechanism (the Web Speech API's `SpeechRecognition`, not `getUserMedia`),
  is not a denied *microphone* in this ticket's sense, and belongs to
  B981/B995/B1004's voice-search territory. Filed as a capture instead of
  folding into this ticket — see B1017 below.
- Did not touch copy (`agent.speechDenied` and neighbours) — it was already
  honest about what happened and what to do about it; no locale files
  changed.
- Does not touch B686 (speech cannot be turned into text) or B744 (the
  consent panel names Deepgram on a dry-run instance) — neither is about how
  a refusal is announced.
- Added `test/record-button-denied.test.tsx`: stubs `getUserMedia` to reject,
  presses the button, and asserts the resulting message is inside a
  `role="alert"` element (not the permanent `role="status"` region), names
  the microphone, and mentions both "settings" and "type" — the two halves
  of "what happened" and "what to do about it". Verified it fails against
  the pre-fix `role="status"` and passes after.

## Acceptance

- `npx vitest run test/record-button-denied.test.tsx` passes. Verified:
  passes with the fix; fails (`role="alert"` element is null) reverted to
  `role="status"`.
- `test/no-browser-dialogs.test.ts` still passes — nothing here uses
  `window.confirm`/`alert`/`prompt`; the announcement is an `aria-live`
  region as before, only its politeness level changed.
- A denied microphone still leaves a way forward: `agent.speechDenied` in
  `en`/`de`/`hu` is unchanged and still says to allow it in the browser's
  settings or type instead. No locale files were touched by this ticket.
- Manual/real-browser confirmation that a screen reader (VoiceOver, NVDA)
  actually announces the `role="alert"` interruption on a real denied-
  microphone prompt was **not done** — this requires a real browser with a
  real screen reader and a real microphone permission to deny, which this
  worktree cannot drive. The `role="alert"` vs `role="status"` distinction
  is standard ARIA behaviour (assertive vs polite) and matches this
  codebase's own established convention (B796 and ~15 other components), so
  the fix is verified against the codebase's own pattern rather than against
  a live screen reader.
