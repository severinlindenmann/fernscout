---
id: B1669
title: Photo visibility and reminder-channel enums are hand-typed in multiple v2 schema files instead of imported
type: CHORE
priority: medium
complexity: low
area: api-v2
found: "2026-09-13T13:56:03Z"
---

# B1669 — Photo visibility and reminder-channel enums are hand-typed in multiple v2 schema files instead of imported

## Why

The golden contract's design rule (`docs/v2-migration/01-golden-contract.md`
and AGENTS.md) is "Enums imported from the constant the validator uses.
Never retyped." Two enums currently violate it:

- Photo `visibility: z.enum(["guest", "private"])` is hand-typed at
  `lib/api/v2/schemas/day.ts:105`, `day.ts:228`, and `dayMedia.ts:21` —
  three separate literals — instead of importing `PHOTO_VISIBILITIES` from
  `lib/photos.ts:43`, a plain module (not `server-only`) that AGENTS.md
  itself calls "the whole vocabulary" for this. `dayMedia.ts`'s copy has a
  comment explaining it could not edit `day.ts` for that ticket, but nothing
  stops either file importing the shared constant instead of a literal.
- The `"mail"|"whatsapp"` channel enum is typed out independently in at
  least five places with no shared source: `lib/tripWrite.ts:71`
  (`REMINDER_CHANNELS`), `lib/api/v2/schemas/social.ts:124`
  (`CHANNEL_NAMES`), and inline literals in `lib/api/v2/schemas/publish.ts:28`,
  `lib/api/v2/schemas/auth.ts:51`, and `lib/api/v2/openapi.ts:391`.

Neither is a live bug today — the values agree — but this is exactly the
shape of drift the rule exists to prevent: adding a channel or a photo
visibility value means finding and editing every one of these by hand, and
missing one ships silently (no test would catch it, since each site
independently validates against its own copy).

## Work

Pick one canonical constant per enum and import it everywhere else:
`PHOTO_VISIBILITIES` (`lib/photos.ts`) for the two-value photo visibility
enum, replacing the three inline `z.enum([...])` literals with
`z.enum(PHOTO_VISIBILITIES)`. For the channel enum, decide which existing
export is canonical (`REMINDER_CHANNELS` in `lib/tripWrite.ts` looks like
the natural home since it's already a plain, non-`server-only` module) and
have `social.ts`, `publish.ts`, `auth.ts` and `openapi.ts` import it instead
of retyping `["mail", "whatsapp"]`.

## Acceptance

`grep -rn '"guest".*"private"\|"private".*"guest"' lib/api/v2/schemas/` and
the equivalent for `"mail".*"whatsapp"` show only the one canonical
definition, with every other site importing it. `npm run verify` passes.
