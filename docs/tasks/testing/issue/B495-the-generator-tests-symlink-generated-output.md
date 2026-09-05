---
id: B495
title: The generator tests symlink generated-output folders into their temp root, so a hand-run script fails the suite
type: ISSUE
priority: medium
complexity: low
area: tests, generators
found: "2026-09-05T15:51:42Z"
started: "2026-09-05T15:52:15Z"
merged: "2026-09-05T15:54:44Z"
---

# B495 — The generator tests symlink generated-output folders into their temp root

## Why

Found on 2026-09-05 when `npm run verify` failed on `main` with three failures
in `test/generator-output.test.ts`, none of which had anything to do with the
change being verified:

```
FAIL  npm run photobook > writes under CONTENT_DIR and leaves nothing beside the code (B219)
      AssertionError: expected true to be false
FAIL  npm run photobook > --out still puts the book exactly where it was asked to
      AssertionError: expected [ ...(18) ] to deeply equal []
FAIL  npm run photobook > --trip is a directory name, and a traversal in it is refused (B242)
      AssertionError: expected [ ...(18) ] to deeply equal []
```

`contentRootOutsideCheckout` (`test/generator-output.test.ts:~250`) builds the
temporary content root by symlinking **every** entry of `content/example/` into
it:

```ts
for (const entry of fs.readdirSync(path.join(real, "example"))) {
  fs.symlinkSync(path.join(real, "example", entry), path.join(journal, entry));
}
```

`photobooks/` and `postcards/` are generated output and gitignored
(`.gitignore:72`). If either exists in the checkout — because somebody ran
`npm run photobook` by hand, or because a killed test run left its output
behind — the temp root gets a symlink of that name pointing back at the
checkout. Then the assertions read the checkout through the link and see files
the script under test never wrote: `lstatSync(out).isSymbolicLink()` is `true`
where the test asserts `false`, and `entries(out)` is the checkout's eighteen
files where the test asserts `[]`.

So the suite passes or fails on whether the developer has ever run the
generator by hand. The failure names three real-looking assertions about
traversal refusal and output paths, none of which is what broke, which is the
expensive part: it reads as "the photobook generator writes outside its content
root", which would be B219 regressing — a defect about somebody's postal
address being written next to the code.

**The neighbouring tests already solved this and the comment says so.** The
postcard case at `:186` and `:202` snapshots the directory first and compares:

```ts
const before = entries(path.join(ROOT, "content", "example", "postcards"));
// ...
// Compared against what was there before rather than asserted absent, because
// a person may have run the script by hand in this checkout and the folder is
// gitignored.
expect(entries(path.join(ROOT, "content", "example", "postcards"))).toEqual(before);
```

The photobook block at `:271`/`:287` does the same thing correctly for the
checkout, and then `:297` and `:329` assert `toEqual([])` against the *temp*
root, which the symlinking makes untrue. The lesson was learned once and
applied to one of the two halves.

## Work

Do not symlink generated-output directories into the temp root. The test wants
the script under test to create them there fresh, so `photobooks`, `postcards`
and `mail` should be skipped by the loop the way `example` itself already is at
the level above — the temp root is meant to be a place where nothing has been
generated yet.

Prefer that to snapshotting `before` in the two remaining assertions: `[]` is
what those tests actually mean, and it becomes true again once the link is not
made. Snapshotting would keep the assertion honest but leave the symlink there
for the next assertion somebody writes.

Check whether any other test builds a content root the same way and inherits
the same problem.

Not doing: the underlying question of whether generated output belongs under
`content/<user>/` at all. It does — see AGENTS.md's content model — and this is
a test-fixture problem, not a layout one.

## Acceptance

- `npm run photobook` run by hand in the checkout, then `npx vitest run
  test/generator-output.test.ts` — 12 passed.
- The same with `content/example/photobooks/` absent — 12 passed.
- No symlink named `photobooks`, `postcards` or `mail` is created inside the
  temporary content root.

## What changed

`contentRootOutsideCheckout` in `test/generator-output.test.ts` skips the
generated-output directories when it links `content/example/` into the
temporary root:

```ts
/** Written by the generators themselves, and gitignored. See B495. */
const GENERATED = new Set(["photobooks", "postcards", "mail"]);
```

Chosen over snapshotting `before` in the two `toEqual([])` assertions, as the
Work section argued: `[]` is what those tests actually mean, and it is true
again once the link is not made. Snapshotting would have kept the assertions
honest while leaving the symlink in place for whoever writes the next one.

The three directories are named rather than derived. Deriving them would mean
reading `.gitignore` from a test, and the set is small, stable and already
written down in the content model in AGENTS.md.

**No other fixture has this shape.** `contentRootOutsideCheckout` is local to
this file, and it is the only place in `test/` that symlinks the real content
root into a temporary one.

## Evidence

The failure reproduces exactly, and the fix survives it. With eighteen files
placed in `content/example/photobooks/` — standing in for a hand-run
`npm run photobook`, or a test killed mid-write:

```
── OLD code, with a hand-run photobooks/ present:
 FAIL  npm run photobook > writes under CONTENT_DIR and leaves nothing beside the code (B219)
 FAIL  npm run photobook > --out still puts the book exactly where it was asked to
 FAIL  npm run photobook > --trip is a directory name, and a traversal in it is refused (B242)
      Tests  3 failed | 9 passed (12)

── NEW code, same dirt present:
      Tests  12 passed (12)
```

Those are the same three assertions, in the same order, that failed on `main`
and started this ticket. With the directory absent, 12 passed both before and
after.

## How it was found

`npm run verify` on `main` failed with these three after a run of B249's own
flake had killed a photobook subprocess mid-write, leaving its output in the
checkout. So the two tickets are one chain: the 5-second default timeout
(B249) killed a generator, the generator's half-written output stayed behind
because it is gitignored, and this fixture then presented it to three
assertions as though the script under test had written it.
