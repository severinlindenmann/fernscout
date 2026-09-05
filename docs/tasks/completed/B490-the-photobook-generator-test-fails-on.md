---
id: B490
title: The photobook generator test fails on any checkout that has generated a photobook
type: ISSUE
priority: low
complexity: low
area: tests
found: 2026-09-05T00:00:00Z
completed: "2026-09-05T17:13:15Z"
---

## Why

> **Verified fixed, 2026-09-05.** B495 is the same defect, found and merged
> the same afternoon: the generator tests symlinked generated-output folders
> into their temp root. Its acceptance command — this task's acceptance
> command — was run in the shared checkout after the fix:
> `npm run photobook -- --trip example/alps-2024`, then
> `npx vitest run test/generator-output.test.ts` → **12 passed**. The
> generated `content/example/photobooks/` was removed afterwards.

`npm run verify` fails on a working checkout, with three red tests in
`test/generator-output.test.ts` and an assertion that reads as though B219 had
regressed:

```
expected true to be false
❯ test/generator-output.test.ts:278
    expect(fs.lstatSync(out).isSymbolicLink()).toBe(false);
```

Nothing has regressed. `contentRootOutsideCheckout`
(`test/generator-output.test.ts:87`) builds the temporary content root by
symlinking **every entry** of `content/example/` into it. `photobooks/` is
generated output and gitignored, so it is absent on CI and on a fresh clone —
and present the moment anybody runs `npm run photobook` once. The helper then
links it, the generator writes through the link, and the test that exists to
prove output does not land beside the code fails because the fixture put it
there.

The reading available to whoever meets it is "this merge broke the photobook",
which is what makes a low-priority fixture bug worth a ticket: it cost a deploy
fifteen minutes today. The postcard tests above have the same helper and the
same hole; they pass only because `content/example/postcards/` happens not to
exist here.

## Work

The helper should link the journal's *inputs* and let the generated folders be
real directories in the temporary root — `trips/`, `config.json` and the rest,
skipping `photobooks/`, `postcards/`, `mail/` and anything else a generator
writes. Skipping by name is the small version; deriving the list from whatever
`lib/paths` already calls generated output is the honest one, if such a list
exists.

## Acceptance

`npm run photobook` in the checkout, then `npx vitest run
test/generator-output.test.ts` — twelve green. Today the first command makes
three of them red.
