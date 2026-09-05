---
id: B393
title: Photographs cannot be added to a published day, and the refusal tells the agent to ask somebody who has no way to do it
type: ISSUE
priority: high
complexity: medium
area: media
found: "2026-09-04T22:39:22Z"
started: "2026-09-05T07:11:49Z"
session: 62683d95-33a6-4db0-a254-7a8fcbcf014e
claimed: "2026-09-05T07:11:49Z"
---

# B393 — Photographs cannot be added to a published day, and the refusal tells the agent to ask somebody who has no way to do it

## Why

`POST /api/v1/<user>/trips/<trip>/media` refuses a published day:

```
409 day_published
"... is published, so this would change a day people have already read.
 Ask the person to add these themselves, or write a new day for them."
```

**There is nobody to ask.** AGENTS.md states the rule this breaks: "There is no
web form and no CMS to fall back on, so if an agent will not do a thing on the
owner's behalf, the thing cannot be done at all." The owner has no upload
widget; the agent is the only door, and this is it refusing.

Confirmed on fernscout.ch (f5561fe) that no other door exists:

- `PATCH .../days/<slug>` with `gallery` -> `unsupported_field`
- `PATCH .../days/<slug>` with `status: draft` -> `unsupported_field`, and the
  message says a day moves between draft and published only through
  `.../publish`, "whatever it is asked to set"
- `.../publish` only publishes

So a published day's photographs are fixed forever, and the advice in the
refusal names an action nobody can perform.

**B266 is the same shape, already fixed for prose.** A wrong date or a missing
coordinate on a published day is corrected by `PATCH`, which says plainly that
readers will see the change and treats that as the ordinary case. Photographs
are the one field that stayed frozen, and there is no reason a picture is more
dangerous to add than a rewritten paragraph.

The caution behind the refusal is real -- changing what readers have already
seen -- but B266 settled that argument: say what the change means and let the
owner decide.

## Work

Let media be attached to a published day, the way `PATCH` lets prose be
corrected, and answer with the same honesty `PATCH` does ("still published --
anyone who already read it can now see this change").

If that is genuinely not wanted, then the refusal must stop naming an
impossible remedy and say what is actually true: the photographs cannot be
added at all.

## Acceptance

Either photographs can be attached to a published day, or the 409 no longer
tells the caller to ask the person to do it themselves.
