---
id: B277
title: The reader languages stay optional at creation, so a journal asked for three gets one
type: ISSUE
priority: high
complexity: low
area: api, journals, i18n
found: "2026-09-04T12:32:34Z"
started: "2026-09-04T12:33:33Z"
merged: "2026-09-04T12:44:10Z"
---

# B277 — The reader languages stay optional at creation, so a journal asked for three gets one

## Why

B263 made `visibility` and `defaultLocale` required and deliberately left
`locales` optional, with this reasoning in its Work section:

> `locales` **stays optional** — defaulting it to `[defaultLocale]` is a real
> default and not a decision taken on somebody's behalf.

That was wrong, and one run was enough to show it. On 2026-09-04 an owner asked
an agent for a German journal readable in German, English and Hungarian. What
B263 fixed held — `content/viki/config.json` has `visibility: private` and
`defaultLocale: de`, both correct and both now impossible to omit. What it left
optional did not:

```json
"defaultLocale": "de",
"locales": ["de"]
```

So the journal offers one language, the switcher shows only Deutsch, and the
owner was told they had three. This is the second time the same owner has been
told they had three languages and had one — the first was B263 itself.

The mechanism is exactly B263's, and it is the argument for making a field
required rather than defaultable: **a weak agent omits whatever it is allowed
to omit**, and then reports its intention. `lib/journals.ts:227` defaults
`locales` to `[defaultLocale]`, which is a *reasonable* default and still the
wrong one to apply silently, because the owner has an opinion about it and was
asked for it. B256 already added the question to both documents — asking is not
enough when the API accepts silence.

The default is also not harmless. `locales` is what the language switcher
renders from, so a journal created without it has no switcher at all — a reader
who speaks one of the other two has no way to reach it, and the owner has no
page in the site to fix it from.

## Work

- **`locales` becomes required** on `POST /api/v1/journals` and on the MCP
  `create_journal` tool, refused when absent in the voice of the two refusals
  B263 added beside it. Name the question: which languages a *reader* may
  switch the journal into, as distinct from the owner's own.
- It must contain `defaultLocale` — a journal whose own language is not on
  offer is a config problem `lib/config.ts:319` already flags. Refuse it at the
  door with a message saying so rather than writing a file that loads with a
  warning.
- Keep the per-entry membership check B263 added.
- Update `/openapi.json` (into `required`, drop any `default`) and both
  generated documents so all three agree.
- Revisit B263's sentence about `locales` being a fair default while you are
  in that file, and correct it — a Work section that argues for what turned out
  to be the bug is worse than none.

Not in scope: a page for an owner to change their journal's languages
afterwards. Worth capturing separately — it is the reason this one is
expensive to get wrong.

## Acceptance

- `POST /api/v1/journals` without `locales` is `400` and says which question to
  ask; the same over MCP.
- `locales` not containing `defaultLocale` is `400`.
- A journal created with `["de","en","hu"]` renders a switcher with all three.
- Tests for each.
- `npm run build`, `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`.
