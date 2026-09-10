---
id: B1322
title: Postcard proposals are still refused after B1284, now because the helper sends an empty signature
type: ISSUE
priority: high
complexity: low
area: helper, postcards
found: "2026-09-10T15:51:14Z"
---

# B1322 — Postcard proposals are still refused after B1284, now because the helper sends an empty signature
## Why

B1284 is merged and its fix is confirmed working on the live instance — the
helper now sends the contact's real id. Driven again on fernscout.ch straight
after that deploy, the captured request body reads:

```json
{"trip":"bern-weekend-2026","date":"2026-09-05",
 "message":"The bears send their love again.",
 "recipients":"8a185cbe-2fdf-4a10-91a6-7fd3adf51050",
 "slug":"2026-09-05","photo":"2026-09-05/01.jpg",
 "from":"","locale":"en"}
```

`recipients` is right now, and `locale` is filled in — both of B1284's fixes
hold. The proposal is still refused, on the next check along:

> That did not work: **invalid_request**

`app/api/helper/[user]/postcard/route.ts:113` refuses when `!message || !from`,
and `lib/helper/tools/areas/printed.ts:274` sends

```ts
{ name: "from", value: args.from ?? "" }
```

so a turn where the model does not supply a signature sends `from: ""` and is
refused every time. Nothing was created: `/<user>/postcards` holds no proposal
for this attempt.

So the postcard flow is **still broken end to end for a person in the room**.
B1284 moved the failure one step later; the refusal a person sees changed from
`unknown_recipient` to `invalid_request`, which is no more readable (B1250's
family).

The signature is a real editorial choice — it is what gets printed on somebody's
card — so defaulting it silently would be the wrong fix.

## Work

- Decide what happens when no signature was given. Asking for it in the room
  before proposing is the honest shape and matches how the flow already asks for
  the message. Defaulting to the owner's nickname is the other candidate and is
  a decision, not an implementation detail — `config.json` has the nickname, but
  putting words on a printed card nobody chose is the thing this project is
  careful about.
- Whatever is chosen, the tool must not send a value the route is guaranteed to
  refuse.
- The refusal a person sees must stop being the raw code (B1250, B1284's own
  closing note).

## Acceptance

- Asking the helper for a postcard with no signature mentioned either produces a
  proposal, or asks for the signature — never a refusal naming an error code.
- The captured request body never carries an empty `from`.
- A postcard proposal reaches `/<user>/postcards/<id>` from the room, which no
  run has yet achieved.
