---
id: B1284
title: Every postcard proposal from the helper is refused, because it sends a name slug where a contact id is required
type: ISSUE
priority: high
complexity: low
area: helper, postcards
found: "2026-09-10T10:50:47Z"
---

# B1284 — Every postcard proposal from the helper is refused, because it sends a name slug where a contact id is required

## Why

The postcard flow cannot be completed through `/agent`. Driven on fernscout.ch,
2026-09-10, with one approved contact who has a postal address and postcard
consent:

The room found her correctly — the card showed **Goes to: Bea Muster, Bern, CH**
— and pressing **Propose these cards** answered

> That did not work: **unknown_recipient**

The request body, captured from the page:

```json
{"trip":"bern-weekend-2026","date":"2026-09-05","message":"…","from":"Mo",
 "recipients":"bea-muster","slug":"2026-09-05","photo":"2026-09-05/01.jpg",
 "locale":""}
```

`recipients` is **`"bea-muster"`** — the contact's *name*, slugified.

`app/api/helper/[user]/postcard/route.ts:80` reads `recipients` as a
comma-separated list of **contact ids** and checks them against
`postcardCandidates(user)`:

```ts
const allowed = new Set(candidates.map((c) => c.contactId));
const unknown = wanted.filter((id) => !allowed.has(id));
```

Bea's `contactId` is `8a185cbe-2fdf-4a10-91a6-7fd3adf51050`. `"bea-muster"` is
never in that set, so **every** proposal from this path is refused, for every
recipient, always.

**The route is correct and works.** The identical call with the real id succeeds:

```
POST /api/helper/test-mobile/postcard  {"recipients":"8a185cbe-…", …}
→ 201 {"ok":true,"id":"d8af4f22-…","status":"draft","recipients":1,
       "credits":{"each":20,"total":20,"balance":309}}
```

So this is the caller, not the contract. Addressing by id rather than by name is
the design AGENTS.md insists on — *"cards are addressed by `contactId` … never to
an address that arrived in a conversation"* — and the helper is bypassing it with
a name it derived itself, which the route then correctly refuses.

Two smaller things in the same body, worth fixing while there:

- `locale` is `""`. The contact has `locale: "en"`.
- `recipients` as a bare string is the route's own contract (`text(body).split(",")`),
  so passing a JSON array answers `no_recipients` — a shape worth documenting in
  `lib/api/openapi.ts` if it is not already, since it surprises the obvious caller.

And the refusal reaches the person as the raw string `unknown_recipient`, which
is B1250's problem again.

## Acceptance

- Proposing a postcard from the helper for an approved contact returns 201 and
  the proposal URL.
- The captured request body carries the contact's id.
- A test covers the helper's postcard call against `postcardCandidates`, so a
  future change to either side fails loudly.
