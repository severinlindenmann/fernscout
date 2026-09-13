---
id: B1676
title: content-model.json advertises v1 write doors and retired journal fields
type: ISSUE
priority: medium
complexity: low
area: docs
found: "2026-09-13T14:28:32Z"
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
