---
id: B1400
title: "publish.mjs reports every requested feature key as applied without reading the response back"
type: ISSUE
priority: high
complexity: low
area: fernscout-helper, publish skill
found: "2026-09-10T21:20:00Z"
---

# B1400 — publish.mjs reports every requested feature key as applied without reading the response back

## Why

**The diff for this one lands in `fernscout-helper`, not here.** Captured here
because that repository has no lane of its own and because the server half is
already correct — see below.

`.claude/skills/publish/publish.mjs:298-308`:

```js
note(`  ${step(`set features — ${…map(([k, v]) => `${k}=${v}`).join(", ")}`)}`);
if (!dry) {
  const patched = await call("PATCH", `/api/v1/${user}/config`, { body: { features } });
  if (!patched.ok) { console.log(`      note: …`); }
}
```

The line naming every key is printed **before** the call, and only a failure
adds anything after it. So a `200` that changed nothing — or changed some of
what was asked — leaves a log that reads *set features — weather=true,
costs=true* with no correction. The person running it is told a capability is
on when it may not be.

That is the failure this project takes most seriously: a sentence on a screen
that is not true of what the turn actually did. It is the same shape as B829's
*"Der Text ist gespeichert."*, arriving through a CLI rather than the helper.

**The server already gives the honest answer.** `PATCH /api/v1/<user>/config`
returns `changed` — the list of keys it actually wrote — plus a `note`
sentence, at `app/api/v1/[user]/config/route.ts:266-269` and `:297-301`,
including *"Nothing changed — the journal already asked for exactly this."* The
script asks and does not listen.

## Work

In `fernscout-helper`:

- Report from `patched.body.changed`, after the call, not from the request
  body before it. Name what changed; when it is empty, say nothing changed and
  why (the response's own `note` already says it).
- Say which keys were asked for and not changed, since the difference is the
  whole point — a capability the server does not offer is a fact about the
  server, which the existing comment already says and which the log should
  keep saying.
- The dry-run branch keeps printing the intent, which is correct there; it is
  the live branch that must report the outcome.
- One small check behind it — a fake response with a partial `changed` must
  produce a log that names the gap. The repo's `*.test.mjs` files beside each
  skill are the pattern.

Nothing to change in this repository. If the review finds another script in
that repo printing an intent as an outcome, capture it rather than folding it
in.

## Acceptance

- A `PATCH` answering `{"changed": []}` produces a log saying nothing changed,
  never *set features — …*.
- A partial `changed` names both halves.
- A refusal reads as it does today.
