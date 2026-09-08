---
id: B853
title: Component tests set input values in a way React never hears
type: ISSUE
priority: medium
complexity: low
area: tests
found: "2026-09-07T17:02:28Z"
started: "2026-09-08T21:27:12Z"
merged: "2026-09-08T21:36:06Z"
---

# B853 — Component tests set input values in a way React never hears

## Why

Found while fixing B838. `test/signup-wizard.test.tsx` was filling inputs with
`node.value = x` followed by a synthetic `input` event.

React installs its own value setter on the input's prototype and tracks the
last value it wrote. Assigning `node.value` directly goes *through* that
tracker, so React concludes nothing changed and the `input` event is a no-op:
**the component's state never moved.** The test passed anyway, because it
asserted against a stubbed error string rather than anything the state
produced.

So a test that appeared to drive a form drove nothing. The fix in B838 was a
`type_()` helper using the prototype setter — the standard remedy — but the
pattern is likely repeated:

```
grep -rn 'dispatchEvent(new Event("input"' test/
```

Each hit is a test that may be asserting against a component whose state never
changed, which is the most expensive kind of passing test: it costs nothing to
run and tells you nothing.

## Work

Walk the grep. For each, check whether the assertion would still hold with the
input untouched; if it would, the test is not testing what it claims. Share one
`type_()` helper rather than repeating the fix.

## Acceptance

Every component test that types into a field actually moves the component's
state, and one helper does it.

## Resolution (2026-09-08)

Walked the grep:

```
grep -rln 'dispatchEvent(new Event("input"' test/
```

Six hits: `test/tel-field-combobox.test.tsx`, `test/signup-wizard.test.tsx`,
`test/helper-chat.test.tsx` (two call sites), `test/helper-room.test.tsx`,
`test/envelope-fly.test.tsx`, `test/helper-voice.test.tsx`.

**The premise of "the pattern is likely repeated" did not hold as a repeat of
the bug** — checked every one of the six by hand: every single one already
read the native value setter off `HTMLInputElement.prototype` before
dispatching the `input` event, i.e. every one already had B838's fix, not the
`node.value = x` bug B838 found. A second grep for the actual bug shape,
`grep -rln '\.value = ' test/`, found no test assigning a value directly and
then dispatching an event — the only two hits were doc comments describing the
bug, in `signup-wizard.test.tsx` and `signin-autofill.test.tsx`. So no test
here was silently asserting against an untouched component; the ticket's
"likely repeated" turned out not to be true for any of the six call sites.

What *was* still true: six files each carried their own copy of the
setter-lookup-and-dispatch snippet — the ticket's other ask, "share one
`type_()` helper rather than repeating the fix," was still outstanding. Added
`test/support/type-input.ts` exporting `typeInto(el, value)` (native setter +
dispatched `input` event, same as before) and switched all six files
(`tel-field-combobox`, `signup-wizard`, `helper-chat` ×2 call sites,
`helper-room`, `envelope-fly`, `helper-voice`) to import and call it, deleting
each file's local copy. Callers still wrap the call in their own `act()` (or
`await act(async () => …)`), since that varies per test and is not the
helper's business.

**No test went red.** Since every call site was already exercising the real
setter, none of these tests changed behaviour — this was a pure dedup, not a
bug fix. Ran the six affected files alone (61 tests, all passed) and then the
full `npm run verify` (452 files, 5811 passed, 4 skipped; build → tsc → eslint
→ vitest → knip all green).

Acceptance, walked line by line:
- "Every component test that types into a field actually moves the
  component's state" — already true before this ticket for all six files
  (verified by reading each site's setter-then-dispatch code); nothing here
  needed to change to make it true.
- "and one helper does it" — was false (six duplicated copies), now true:
  `test/support/type-input.ts`'s `typeInto()` is the only place the
  setter-lookup lives, used by all six test files.

No captures filed — nothing else found while doing this that wasn't already
this ticket's own scope.
