---
id: B853
title: Component tests set input values in a way React never hears
type: ISSUE
priority: medium
complexity: low
area: tests
found: "2026-09-07T17:02:28Z"
started: "2026-09-08T21:27:12Z"
session: bdd0270d-3797-42c9-8687-06abecadbc63
claimed: "2026-09-08T21:27:12Z"
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
