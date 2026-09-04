---
id: B220
title: The rest of a journal's config.json still cannot be changed after it is created
type: ISSUE
priority: low
complexity: medium
area: config, api
found: "2026-09-04T06:41:01Z"
started: "2026-09-04T08:57:04Z"
merged: "2026-09-04T09:30:14Z"
completed: "2026-09-04T21:54:16Z"
---

# B220 — The rest of a journal's config.json still cannot be changed after it is created

## Why

Found while building B182, which asked which fields a config-writing call
should cover and deliberately answered "the `features` block only".

`PATCH /api/v1/<user>/config` and MCP `set_journal_features` now write that
block, so a journal is no longer frozen as whatever `createJournal` said on the
day it ran. Everything else in `content/<user>/config.json` still is:

- **`title`** and **`tagline`** — what the site is called. A typo made at
  signup is permanent without a shell on the server.
- **`locales`**, **`defaultLocale`** — the languages the journal speaks.
- **`baseCurrency`**, **`displayCurrencies`**, **`manualRates`** — how money is
  read across every trip.
- **`units`**, **`startLocation`**, **`visibility`** — the journal's own
  `public`/`private`, which decides whether this instance advertises it at all.
- **`media`** — a journal's own narrowing of the server's upload limits.

None of it is a capability, so none of it is covered by B182, and each has the
same shape of consequence: the person who owns the journal has never seen the
folder, so "edit config.json" is advice with nowhere to go (B28).

`owner.email` is **not** in this list and should stay out of it. It is the
address that decides who can obtain a token for the journal (decision 24), and
a token must not be able to move the boundary that issued it. B182's endpoint
refuses the whole body when it names anything but `features`, and that refusal
says so.

## Work

- Decide per field rather than opening the whole file. `visibility` and
  `baseCurrency` change what readers see and what every cost means; `title` and
  `tagline` are cosmetic. They do not deserve the same care.
- Whatever is accepted goes on **both** doors with the round trip asserted,
  the way B178 and B175 did for trip fields.
- Reuse `setJournalFeatures`'s shape: edit the file in place rather than
  regenerating it, so keys this code has never heard of survive; read back
  through `getUser` and restore the previous bytes if it does not parse.
- `manualRates` and `media` are maps rather than scalars and need a shape check
  before they reach the file.

Not doing: a settings page. There is no editing interface and there will not be
one (decision 24).

## What was done

A decision per field, as asked. Nine writers and three reasoned refusals.

**Written** — `setJournalProfile` in `lib/journals.ts`, and
`JOURNAL_PROFILE_FIELDS` is the whole list:

| | |
| --- | --- |
| `title`, `tagline`, `startLocation` | Cosmetic, one line of plain text, and the case the ticket opens with: a typo made at signup was permanent. `""` **removes** the key rather than writing an empty string — `readString` refuses an empty tagline, so `"tagline": ""` would be a journal that will not load. |
| `units` | An enum of two. Nothing to be careful about. |
| `visibility` | Accepted after checking what it actually decides: whether this instance *advertises* the journal, not who may read anything. A private journal is unlisted, not locked. Both doors say so and say to ask first. |
| `locales`, `defaultLocale` | The one pair with a cross-field rule. `parseUser` treats a `defaultLocale` outside `locales` as a config problem, and a config problem takes the whole journal off the site — so the rule is checked against the *result* before anything is written, and either field may arrive alone. |
| `displayCurrencies` | Presentational: which currencies a reader can see totals in. Normalised on the way in, and refused unless it contains the journal's base currency, which is the other thing `parseUser` would refuse. |
| `manualRates` | **Merged**, not replaced, so one currency can be corrected without holding the table; `null` removes a code, or a rate typed wrongly could never be taken out. The direction is the ECB's — units per one euro — which is the opposite of a trip's own `rates:`, and both doors say so, because B17 is about exactly that confusion. |

**Refused, each with its own sentence in `JOURNAL_FIELD_REFUSALS`:**

- **`owner.email`** — unchanged from B182. The address that decides who can
  obtain a token, so a token must not move it.
- **`baseCurrency`** — the field that reads like a display setting and is not,
  and the reason is concrete rather than cautious: a cost written without a
  `currency:` **is** a cost in the base currency (`lib/entries.ts:144`,
  `lib/costs.ts:40`). Changing it does not reconvert money — it changes what
  every bare amount ever written *meant*, with no error anywhere and no repair
  except editing every entry. It is safe exactly once, when the journal is
  created, which is where `createJournal` and `create_journal` take it.
- **`media`** — the operator's, not the journal's. `narrowest()` already makes
  the server a ceiling over it, so the only reachable effect is to make the
  journal accept *less* than the operator allows, and a widening request is
  silently narrowed rather than refused. Writing something inert is what B182
  would not ship.

**One kind of change per call.** A body naming `features` alongside a profile
field is `400 mixed_change` and writes nothing. Each call edits `config.json`
whole — read, change, write, read back through `getUser`, restore the previous
bytes if it does not load — and a request doing that twice is one that can
succeed halfway. Over MCP the same line falls out of the shape: two tools.

`setJournalFeatures`'s file-editing half was extracted rather than copied —
`editUserConfigFile` is now the one place that edits that file, keeps keys this
code has never heard of, and puts it back if the result does not parse.

### Where

- `lib/journals.ts` — `editUserConfigFile`, `setJournalProfile`,
  `journalProfile`, `JOURNAL_PROFILE_FIELDS`, `JOURNAL_FIELD_REFUSALS`.
- `app/api/v1/[user]/config/route.ts` — `PATCH` takes the fields, refuses the
  three by name with the reason, refuses the mix; `GET` returns them under
  `journal`, including the `baseCurrency` a caller needs to send a usable
  `displayCurrencies` and cannot change.
- `lib/mcp/tools.ts` — `set_journal_profile`, beside `set_journal_features`.
- `lib/locales.ts` — `LOCALE_TAG_RE`, shared with B207's `translations:` writer.
- `/agent.md`, `/openapi.json`, `docs/providers/mcp.md`.

### Evidence

- *"For each field above, a writer with a round-trip test, or a sentence saying
  why it stays file-only."* — `npx vitest run test/journal-features.test.ts`:
  31 tests, of which 14 are new and all 14 fail against `git show HEAD` of the
  three changed files. The both-doors round trip is "a title typoed at signup
  can be fixed, through both doors identically", which asserts MCP writes the
  file byte-for-byte the same as REST. `baseCurrency` and `media` each have a
  test that they are refused *and that the refusal says why*, plus one that
  MCP's `inputSchema` has no property for them and `additionalProperties` is
  false.
- *"`owner.email` is still refused, and the test that says so still passes."* —
  it does, unchanged, and it passed against `HEAD` in the before/after run
  above (17 of the 31 passed there, that one among them). It is now stronger:
  the body it sends carries `title`, which this call *does* write, and the
  assertion is that the file is untouched — a caller cannot smuggle a change
  past by attaching one that is accepted.
- `npm run build` ✓, `npx tsc --noEmit` ✓, `npx eslint .` 0 errors (4
  pre-existing warnings), `npx vitest run` 2270 passed / 3 skipped.

## Acceptance

- For each field above, the file records either a writer with a round-trip
  test, or a sentence saying why it stays file-only.
- `owner.email` is still refused, and the test that says so still passes.
