---
id: B1676
title: content-model.json advertises v1 write doors and retired journal fields
type: ISSUE
priority: medium
complexity: low
area: docs
found: "2026-09-13T14:28:32Z"
merged: "2026-09-14T07:06:46Z"
---

# B1676 — content-model.json advertises v1 write doors and retired journal fields

## Why

`lib/contentModel/doors.ts` still names v1 routes, and
`lib/contentModel/document.ts:452` wires `doors: contentModelDoors()` into the
document served at `app/content-model.json/route.ts`. Live:

```
$ curl -s https://fernscout.ch/content-model.json | python3 -c "…['doors']…"
{"config.json": {"create": "POST /api/v1/journals",
                 "call": "PATCH /api/v1/{user}/config",
                 "update": {"startLocation": "PATCH /api/v1/{user}/config",
                            "manualRates": …, "travellers": …, "features": …}}}
```

`POST /api/v1/journals` answers 404 (verified). `startLocation`, `manualRates`
and inline `travellers` are fields decision 5 retired. So the document an agent
is meant to read to learn *which call writes which field* advertises a dead
door and four fields that no longer exist.

`docs/v2-migration/02-plan.md` listed this section for deletion; it was not
done, and no delta row records the decision to keep it.

## Work

Either regenerate `doors` from the v2 routes, or delete the section and let
`/api/v2/openapi.json` be the single answer to "which call writes this field".
The second is the smaller diff and matches decision 7 (one fact, one address).

Whichever is chosen, record it as a delta row in
`docs/v2-migration/06-contract-deltas.md`.

## Acceptance

- `curl -s https://fernscout.ch/content-model.json` names no route that 404s.
- No retired field appears in it.
- A test walks the document's route strings and asserts each resolves to a
  route file on disk.


---

## Done, 2026-09-14 — doors kept, and the reason is recorded as D22

The plan's checklist said delete the `doors` section. It is kept, because
**B1577 made it load-bearing after that checklist was written**:
`test/content-model-doors.test.ts` is a two-way gate — add a key without saying
which call writes it and it is red, name a door for a key the file does not
have and it is red the other way. It exists because the same failure happened
twice a year apart (B1518, B1569): a field accepted by a client's local check,
never sent, and reported to the person as a success. Nothing in v2 replaces it,
because the gate is about a client in another repository rather than this
server's own schemas.

So every door is repointed at its v2 route instead, and `tracks` — retired — is
dropped from the trip's model. `docs/v2-migration/06-contract-deltas.md` D22
carries the table and the argument.

Verified live: `curl -s https://fernscout.ch/content-model.json` names no
`/api/v1` route.

**What is not fixed is larger than what is, and it is B1700.** The document
still describes v1's *content model*: `trip.md`, `costs.md`, `plan.md`,
"the prose under the frontmatter", `start`/`end` where a trip carries `dates`,
`startLocation` and `features` on a config that has neither — and no `declined`
at all, on an instance where that key is the contract. Repointing the doors
stops it sending an agent to a 404; it does not make the document true.
