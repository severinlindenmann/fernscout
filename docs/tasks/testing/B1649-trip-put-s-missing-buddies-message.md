---
id: B1649
title: trip PUT's missing-buddies message gives no schema and no pointer to the invites endpoint
type: ISSUE
priority: low
complexity: low
area: API v2
found: "2026-09-13T08:38:51Z"
merged: "2026-09-13T19:50:28Z"
---

# B1649 — trip PUT's missing-buddies message gives no schema and no pointer to the invites endpoint

## Why

`PUT /api/v2/{user}/trips/{trip}` with only one person in `people` and no
`declined.buddies` answers `422 incomplete` live (`fernscout.ch`, commit
`07345e79`):

```json
{"field":"buddies","why_required":"only one person is on this trip — add the buddies who were there (name + email; the server mails them), or decline: declined.buddies (e.g. travelling solo)","to_decline":"declined.buddies: <reason>"}
```

Every other entry `incomplete` has ever returned in this pass (`days`, and by
the schema's shape presumably every field on the list) carries a `to_provide`
JSON-Schema excerpt beside `to_decline`. `buddies` does not, and there is no
`buddies` property anywhere in the trip's own request schema in
`/api/v2/openapi.json` — because buddies are not a field on the trip document
at all; a buddy is added via `POST /api/v2/{user}/invites` with
`{"kind":"buddy","trip":"<id>","email":...,"name":...}` (confirmed present in
the openapi paths), which AGENTS.md also describes as the only mechanism
(B33).

The message's own wording — "add the buddies ... (name + email; the server
mails them)" — reads exactly like the other missing-field messages that mean
"send this in the same request", with no hint that this one field means a
separate call to a separate endpoint. An agent with only the document in hand
(the stated situation for this whole phase) has no way to discover
`/invites` from this message alone, and is left with the choice of declining a
real trip's buddies or reverse-engineering a whole other route.

## Work

Give the `buddies` entry in `incomplete`'s `details.missing` a pointer at
`POST .../invites` (`kind: "buddy"`) instead of, or beside, the `to_provide`
shape every other field gets — worded so it is clear that adding a buddy is
not a field on this request body.

## Acceptance

The `incomplete` response for `buddies` names the endpoint and payload shape
that actually adds one, the same way `days`' entry names the day schema.
