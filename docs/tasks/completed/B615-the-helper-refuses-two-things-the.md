---
id: B615
title: The helper refuses two things the instance accepts
type: ISSUE
priority: high
complexity: low
area: fernscout-helper, validate-content, model.mjs
found: "2026-09-06T15:36:52Z"
started: "2026-09-06T18:00:08Z"
merged: "2026-09-06T18:25:03Z"
completed: "2026-09-07T13:12:28Z"
---

# B615 — The helper refuses two things the instance accepts

## Why

Found by the conformance test built in B608 — the first thing it did, which is
what it is for. Both are **live false errors**: a journal the instance would
accept is reported as wrong by `validate-content` today, and a person following
the report would edit correct content to satisfy a rule that does not exist.

**`countryCode` — capitals only.** `fernscout-helper`'s
`shared/model.mjs:119` carries `pattern: /^[A-Z]{2}$/`, "two capitals, like
PT". The server's own check is explicitly case-insensitive:

    lib/validate/entry.ts:239   const COUNTRY_CODE_RE = /^[A-Za-z]{2}$/;

So a day carrying `countryCode: "pt"` publishes cleanly and validates as an
error.

**`locales` and `defaultLocale` — required.** `model.mjs:65-66` marks both
`required: true`. `parseUser` in `lib/config.ts:461-462` defaults them both:

    const locales = readStringArray(src, "locales", "", problems, ["en"]);
    const defaultLocale = readString(src, "defaultLocale", "", problems, locales[0]);

A `config.json` naming neither is a valid journal in English. The helper calls
it two errors.

Both are copied-model errors of the kind W41 is about: nothing fetched has
drifted, and everything copied has. They are filed together because they share
one fix and one file.

Note the direction. B616 is the opposite failure — the helper silent where the
server refuses — and the two are kept apart because their consequences differ:
this one **wastes a person's time and can make them break working content**;
that one lets a bad journal reach a refusal later.

## Work

- Correct both rules in `shared/model.mjs` against the server's own regex and
  defaulting, not against what the note says.
- `countryCode`'s `expected` prose ("two capitals, like PT") is a style
  preference, not the contract. If the journal should prefer capitals, that is
  a **tip**, not an error — the repository's own definition: an error is what
  the instance will refuse.
- Add both cases to the `perfekt` fixture — a lowercase `countryCode`, and a
  `config.json` that omits `locales` — so they cannot come back. `perfekt`
  must stay at 0 errors.
- Once B609/B610 land and the rules come from `content-model.json`, this fix
  belongs in `lib/contentModel/document.ts` instead. Whichever is current when
  this is picked up: fix it in the one place that is then the source, and say
  which.

## Acceptance

- A day with `countryCode: "pt"` validates clean.
- A `config.json` with neither `locales` nor `defaultLocale` validates clean.
- `test/content-model.test.ts` — which currently asserts both **as
  disagreements** — is updated to assert agreement, and fails if either
  regresses.
- `selftest.mjs` passes; `npm run verify` green.
