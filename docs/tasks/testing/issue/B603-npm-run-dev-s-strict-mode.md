---
id: B603
title: A dev-mode-only effect race can pass or fail local browser testing for the wrong reason
type: ISSUE
priority: low
complexity: low
area: photobook, testing
found: "2026-09-06T14:46:31Z"
started: "2026-09-07T10:37:32Z"
merged: "2026-09-07T11:00:38Z"
---

# B603 — A dev-mode-only effect race can pass or fail local browser testing for the wrong reason

## Why

Verifying B507's acceptance line "an arrangement survives the tab closing"
found the photobook composer's `localStorage` persistence reliably wiped an
arrangement on the very next reload — reproducible every time, under `next
dev`. It did **not** reproduce under `next build && next start`.

The cause (fixed in B507): the restore-then-persist pair of effects guarded
the persist half with a `useRef` flipped to `true` synchronously inside the
restore effect, before the `setOptions` it had just queued had landed in a
render. React's Strict Mode double-invokes effects in development only; under
that double invocation the persist effect ran with the ref already `true` and
the render's `options` still at their default, overwriting the real saved
value. Production never double-invokes, so it never raced.

That direction is the concerning one for `.claude/skills/test-in-a-browser/`:
it drives `next dev` because that is what boots fastest locally, and its own
instructions treat what shows up there as the truth about a page. Here dev
showed a real bug that also happens to be invisible in the environment the
skill cannot easily drive (a production build) — this time the fix was
genuinely warranted, verified correct in both modes, and covered by a test.
But the skill gives no guidance for the opposite pull: a finding that appears
*only* in `next dev` is not automatically a phantom to ignore, and is not
automatically a real bug either — Strict Mode's double effect invocation is a
known source of exactly this class of divergence, and nothing prompts an
agent testing locally to ask which side of it they are looking at.

## Work

Something for `.claude/skills/test-in-a-browser/SKILL.md` (or a linked note)
that names the trap: a persistence/effect-ordering finding seen only under
`next dev` should be cross-checked against `npm run build && npm run start`
on the same port before it is reported as a real user-facing bug — and,
separately, before a "looks fine" is trusted, since Strict Mode's double
invocation is also the thing that would have *caught* this had anyone run the
composer in a browser sooner (B506 has been sitting unverified since it was
filed). Not proposing a mechanism to detect this automatically; the ask is
narrower — one paragraph so the next agent knows the check exists and why the
two modes can honestly disagree.

## Acceptance

- `test-in-a-browser`'s skill doc mentions the dev/production divergence for
  effect races (Strict Mode double-invocation) and says to confirm a
  persistence-style finding under a production build before reporting it.

## Done, 2026-09-07

Added a paragraph to `.claude/skills/test-in-a-browser/SKILL.md`'s "What this
cannot tell you" section, naming B603's own bug as the worked example: names
Strict Mode's dev-only double effect invocation, says to cross-check a
persistence/effect-ordering finding against `npm run build && npm run start`
on the same port before reporting it as real, and the converse the ticket
also asked for — that a "looks fine" under `next dev` is not automatically
trustworthy either, since the same double invocation is what would have
caught this bug sooner. No detection mechanism added, per the ticket's own
scope.

`npm run verify` passed.
