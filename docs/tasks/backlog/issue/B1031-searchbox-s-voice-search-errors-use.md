---
id: B1031
title: SearchBox's voice-search errors use role=status, not role=alert
type: ISSUE
priority: low
complexity: low
area: agent, a11y
found: "2026-09-08T20:41:23Z"
---

# B1031 — SearchBox's voice-search errors use role=status, not role=alert

## Why

Found while fixing B813 (a denied microphone in `RecordButton.tsx` was
announced with `role="status"`, the same polite priority as an ordinary
status update, instead of `role="alert"` like every other error line in this
codebase). `components/SearchBox.tsx` has its own, separate error state for
its own, separate mechanism — the Web Speech API's `SpeechRecognition`, not
`RecordButton`'s `getUserMedia` — and it has the identical fault:

```tsx
// SearchBox.tsx:398 and :420
{voiceError && (
  <p role="status" className="mt-2 text-sm text-coral-600">
    {voiceError}
  </p>
)}
```

`setVoiceError` (line ~226-232) covers a blocked microphone
(`search.voiceBlocked`), no speech detected, no service available, and a
generic failure — all of them a problem stopping the one thing that control
does, not a status update. `role="status"` is `aria-live="polite"` and can be
missed entirely by a screen reader user; this codebase's own convention
(B796, and the ~15 components enumerated in B813) is `role="alert"` for
exactly this class of message.

Out of scope for B813 itself: `SearchBox` is a different mechanism from
`RecordButton`, and its voice-search behaviour already has open tickets
(B981, B995, B1004, B1006, B975) that know its history better than a ticket
about `RecordButton`'s own denial copy should.

## Work

Change both `role="status"` occurrences in `components/SearchBox.tsx` (the
`voiceError` block around line 398, and the `agent === "error"` block around
line 420) to `role="alert"`. Same one-line shape as B813's fix. Check whether
either block is also missing from an existing test file and, if there is a
gap, add the same kind of assertion B813 added
(`test/record-button-denied.test.tsx`) rather than trusting the change by
eye.

## Acceptance

- Both error paragraphs in `SearchBox.tsx` use `role="alert"`.
- A test exercising the blocked-microphone and failed-transcription paths
  asserts the message lands in a `role="alert"` element.
- `npm run verify` passes.
