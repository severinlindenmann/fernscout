---
id: B785
title: An agent-facing English refusal is shown to a person on a German screen
type: ISSUE
priority: medium
complexity: low
area: agent, i18n
found: "2026-09-07T14:29:54Z"
started: "2026-09-08T20:43:39Z"
session: bdd0270d-3797-42c9-8687-06abecadbc63
claimed: "2026-09-08T20:43:39Z"
---

# B785 — An agent-facing English refusal is shown to a person on a German screen

## Why

Going back to the first step and pressing "Diesen Tag beginnen" again for the
same trip and date surfaces the raw refusal from `lib/api/entries.ts:499` —
`"an entry already exists at 2026-05-04-…"` — through `agent.failed`, in
English, on a German screen.

The behaviour is right: it refuses rather than duplicating the day. The
sentence was written for an agent reading an API, and B769's back control made
it reachable by a person.

There will be more of these: every refusal `lib/api/*` writes is written for a
machine, and the helper now shows some of them to people.

## Work

Map the refusals the helper can actually surface to translated sentences, and
say what to do next — this day already exists, carry on with it. Start with the
ones reachable from the wizard rather than translating everything.

## Acceptance

No English API sentence appears on a German helper screen for a refusal a
person can reach by ordinary use.

## What was found and done

Confirmed still real: `app/api/helper/[user]/day/route.ts:151-152` relayed
`createDraft`'s own return value straight into the JSON `error` field.
`createDraft` (`lib/api/entries.ts:519`) returns the English sentence
`` `an entry already exists at ${input.date}-${slug}` `` for the exact
collision the ticket names — pressing "Diesen Tag beginnen" twice for the same
trip and date. `components/HelperAsk.tsx`'s `failureSentence()` (built by
B948, which added `NAMED_FAILURES` and `test/helper-failure-sentences.test.ts`)
only recognises fixed string-literal codes; that test's own route scanner
(`refusalsOf()`) matches `error:\s*"([a-z_]+)"` and is blind to a route that
forwards a *variable* holding a free-text sentence, which is exactly this
shape — so B948 did not, and could not, catch it.

Root-cause fix, not a text patch on this one sentence: `WriteResult` in
`lib/api/entries.ts` gained an optional `code?: string` alongside `error`.
`error` stays the English sentence an over-the-network agent reads from
`/api/v1/.../days` (documented free text at 409 in `lib/api/openapi.ts`,
unchanged) — `code` is a stable identifier the *helper* route may prefer. The
one place it is set today is the collision `createDraft` already had, tagged
`code: "day_exists"`. `app/api/helper/[user]/day/route.ts`'s `POST` now
answers `written.code ?? written.error`, so this refusal reaches the browser
as `"day_exists"` and `failureSentence()` turns it into a real sentence via
new `agent.error.day_exists` keys in `site/locales/{en,de,hu}.json`
(`lib/i18n.ts` regenerated with `npm run i18n:keys`).

Scope, deliberately: only the `createDraft` collision this ticket names.
`lib/api/entries.ts` has other free-text refusals (`editEntry`,
`publishDraft`, `unpublishDraft` and the "second collision" branch just below
this one, on a slug taken by a *different* date) that helper routes
(`day/route.ts` PATCH, `day/publish`, `day/unpublish`, `day/costs`) also
forward raw. Checked each for reachability "by ordinary use" of the wizard:
every one I found is either pre-guarded by a stable-code check before the
free-text branch is ever reached (e.g. `already_published`,
`incomplete_day`), or is a `bug: true` / file-corruption / concurrent-write
case that is not ordinary use. The one exception is the "second collision"
branch in `createDraft` itself (a slug taken by a *different* date) — in the
wizard's `start_day` flow `title` is always the date string, so this is not
practically reachable there either, and giving it its own sentence would need
different guidance text ("give this day a different title") that is out of
scope for "start with the ones reachable from the wizard." Filed as a
separate backlog capture rather than silently absorbed — see the capture id
in the session report.

## Acceptance, walked

- `test/helper-start-day-press.test.ts` — new test "pressing again for the
  same day answers a stable code, not the raw English sentence — B785":
  posts `start_day` twice for the same trip/date. Verified failing before the
  fix (`answer.error` was `"an entry already exists at 2026-05-01-…"`) and
  passing after (`"day_exists"`).
- `npm run i18n:keys` regenerated; `test/locales.test.ts` (35 tests) and
  `test/helper-failure-sentences.test.ts` (36 tests) both pass — every
  maintained locale (`en`, `de`, `hu`) carries `agent.error.day_exists` with
  real, non-machine-sounding German and Hungarian sentences, not copies of
  English.
- `npm run verify` — full run, all green: build → tsc → eslint →
  5791 passed / 4 skipped vitest tests → knip.
