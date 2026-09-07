---
id: B721
title: The upload progress line does not say which day it belongs to
type: ISSUE
priority: low
complexity: low
area: agent, ui
found: "2026-09-07T11:44:11Z"
started: "2026-09-07T12:55:02Z"
completed: "2026-09-07T13:19:13Z"
---

# B721 — The upload progress line does not say which day it belongs to

## Why

The upload progress line in `components/AgentWizard.tsx` follows the person
through the wizard, which is right — the originals keep climbing while they
write. But a queue row is keyed to the day it was picked for, so somebody who
picks photographs, walks on, and then opens a *different* unfinished draft
still sees the first day's originals counting up, with nothing on screen saying
which day they belong to.

Correct behaviour, unclear label.

## Acceptance

The progress line names the day it is about whenever that is not the day on
screen.

## Work done

`components/uploadQueue.ts`: `QueueProgress` now carries `slug` — the day the
outstanding rows were picked for (`rows[0]?.slug ?? null`), reported by
`drain()`. Added a pure `uploadingDaySlug(progress, onScreenSlug)` helper
beside the type: returns the queue's day when it differs from what is on
screen, `null` otherwise.

`components/AgentWizard.tsx`: the progress line now prefixes itself with
`t("agent.uploadingFor", { date })` when `uploadingDaySlug` returns a day.
New key `agent.uploadingFor` added to `site/locales/{en,de,hu}.json` and
`lib/i18n.ts` regenerated (`npm run i18n:keys`).

Test: `test/upload-queue-day-label.test.ts` — a pure unit test of
`uploadingDaySlug` covering empty queue, matching day, differing day, and no
day on screen yet. (The browser half of this file is checked by driving a
phone, per the existing comment in `test/agent-wizard-upload.test.ts`; this is
the one piece of new decision logic that is a plain function and testable
without a browser.)

Acceptance met: the line only ever names a day when it differs from the one
on screen.
