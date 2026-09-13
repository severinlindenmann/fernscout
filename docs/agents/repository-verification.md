## Working in this repository

- **Local dev is SQLite, production is Postgres**, and nothing outside
  `lib/db/` knows which.
- **No feature needs a paid account to develop or test.** Mail writes `.eml`
  files under `<dataDir>/mail/<user>/` — or `<dataDir>/mail/.mail/` when it
  belongs to no journal yet, which is signup codes — OTP codes are printed,
  and every print provider has a `dry-run` backend that writes files. Every
  path `lib/mail` can write to is under `dataDir()`; nothing lands next to the
  code (B111), and nothing lands under `contentRoot()` either, so it is never
  in a backup or an export (B636).
- **Every optional capability is off by default** and must be *absent* rather
  than broken when disabled. `lib/capabilities.ts` decides, and `/api/health`
  explains why something is off.
- **Secrets never enter `site/config.json`** — environment only.
- **The browser never asks the question.** No `window.confirm`, no `alert`, no
  `prompt`: they render in the operating system's own type, in a box whose
  title bar names the domain, over a page that has gone to some trouble to
  look like somebody's travel journal — and each shows exactly one string, so
  none of them can say what is about to be deleted, what a thing will cost, or
  offer a second choice beside the first. A confirmation is
  `components/ConfirmPanel.tsx`: a panel in the flow, with a button that says
  what it *does* rather than "OK". B633 decided this and wrote it down; B661
  and B664 each reached for `confirm()` again within the fortnight, so B668
  made it `test/no-browser-dialogs.test.ts` as well.
- **Nothing personal in code.** `test/depersonalised.test.ts` fails the build if
  a real name or trip id appears in `lib/`, `app/`, `components/`, `scripts/`
  or `public/`. `content/` and `site/` are where those names belong — an
  imprint is nothing but real names.

### Verifying a change

```bash
npm run verify         # build → tsc → eslint → vitest → knip, stopping at the first failure
npm run verify -- --quick   # the same without the build; see below for when that is honest
```

**One command, and it is the whole gate.** It was four typed by hand, in an
order that matters, and running them separately is how the order gets lost. The
dev server must still boot with a capability both on and off; nothing automates
that.

**And it is not the gate for anything a person looks at.** A green suite says
the mechanism works on the case you built for it — which is the one case that
cannot surprise you. A visible change is finished when it has been seen on
content that existed *before* the branch: an existing day, an existing trip, a
page nobody wrote for the test. B42 shipped a reader's own clock beside a day's
local time, checked it on the two demo days the same change had edited to carry
the new field, and passed; every day already written showed nothing at all,
because nothing filled that field in. The feature was inert everywhere it
mattered and no test could have said so. B1090. `work-on-a-task` step 5,
`test-in-a-browser` and `check-a-drawing` each carry the procedure.

**While you are iterating, run the one test file** — `npx vitest run
test/thing.test.ts` — and keep `verify` for the end. Measured on this
checkout: `npx vitest run` alone is well over four minutes across 500-odd
files, and the build is under a minute; a full `npm run verify` is closer to
five. A change is usually wrong in one file at a time, which is what makes the
single-file run worth the habit.

**Why the build goes first, since the script no longer makes you think about
it.** Next generates the typed-route definitions in `.next/types` during a
build, and `PageProps`, `LayoutProps` and `RouteContext` resolve against them.
On a checkout where no build has run since a route appeared — a fresh worktree,
or `main` right after a merge that added routes — `npx tsc --noEmit` reports
dozens of errors in files you never opened, and the honest readings available
to you are "the merge is broken" or "the documentation is wrong". Neither is
true; the types have not been generated yet. `.github/workflows/ci.yml` builds
before it typechecks for the same reason. B100.

**`--quick` skips the build, and is honest in exactly one situation:** you have
already built in this checkout and have not added, moved or deleted a route
since. Editing a component's body does not invalidate `.next/types`; adding
`app/foo/page.tsx` does. It refuses outright when nothing has been built here,
rather than handing you the confusing failure above. When in doubt leave it
off — seventy seconds is cheaper than an afternoon spent misreading `tsc`.

**`npm run unused` (knip) is the last step, and used to be nobody's.** It
answers the question the other four do not — *is anything here for nothing* —
and it used to run in CI alone, on the theory that the answer changes rarely.
It changes on an ordinary edit more often than that theory allowed: removing
the last caller of an exported symbol is enough, and CI's own `unused` job
failing on a change that had already passed a clean `verify` locally is exactly
this file coming back to say so twice. `verify` now runs it every time, last,
because it is fast — under two seconds, no network — and failing here is a
diff away rather than a CI round-trip away. It fails on a file nothing
reaches, a dependency nothing imports, an import of something undeclared, or
an `export` nothing outside its own file uses; fix the last of those by
dropping the `export` keyword rather than deleting the code. Unused *exported
members* (of an enum, say) it still only prints. `knip.jsonc` carries the
entry points, which are the whole configuration — nearly nothing here is
imported by name. B24.

### A new string in the UI is three files and a script

`t("nav.gallery")` resolves against `site/locales/en.json`, `de.json` and
`hu.json`, and a key added to one of them is a broken build in two ways at
once. `test/locales.test.ts` asserts that **every maintained locale covers
every key English has**, so English alone fails; and `lib/i18n.ts` carries a
`TranslationKey` union that must hold *exactly* the shipped English keys, so
a hand-written union fails too. Regenerate it rather than typing it:

```bash
npm run i18n:keys      # rewrites the union in lib/i18n.ts from site/locales/en.json
```

Write real German and real Hungarian. Nothing checks that a translation means
anything — the tests only check that a key is present and, for a sample, that
it differs from the English — so a plausible-looking machine translation ships
and is read by somebody whose language it is. If you cannot write the language,
say so and leave the ticket short of done; that is the same rule as inventing a
day, one level down.

### Changing a route means changing the contract

**`/openapi.json` and the `/skill/*.md` guides are the product, for everybody
who is not standing in this checkout.** There is no CMS (decision 24), so an agent
over the network — whether it is somebody's own, or the model behind the web
helper at `/agent` — has the document and nothing else — no source to read,
no colleague to ask. A field the code accepts and the document does not
describe is a field nobody outside will ever use; a field the document promises
and the code drops is worse, because the caller is told it worked.

So, whenever you touch anything under `app/api/`:

- **A `/api/v2/**` route's contract comes from its Zod schema, in
  `lib/api/v2/schemas/`** — `/api/v2/openapi.json` is generated from those
  schemas (`lib/api/v2/openapi.ts`), so a new route or field is a schema
  change, not a second document to keep in step. A surviving
  `/api/v1/**` or `/api/auth/**` route is still hand-maintained: every such
  operation goes into `lib/api/openapi.ts`, with at least one refusal
  documented beside the success.
- **A new field on a request body goes into its schema**, with the type and,
  if it has one, the `enum`.
- **An enum is imported, never typed out.** `TRANSPORT_MODES`,
  `COST_CATEGORIES`, `FEATURE_NAMES`, `TRACKS`, `VISIBILITIES`, `ACCENTS`,
  `STATUSES`, `FIGURE_FIELDS`, the media formats — the document imports the
  constant the validator uses. Export the constant if it is private; a second
  list beside the first is a list that will disagree with it.
- **A field the API takes is a field it has to show.** If a write accepts it,
  some documented `GET` has to read it back, or an agent cannot check its own
  work — and "it was accepted" is not the same claim as "it is there".
- **A limit belongs where a caller can read it before they hit it.**
  `/api/health` carries the upload formats and sizes for that reason.

`npm run verify` enforces the mechanical half. `test/openapi-contract.test.ts`
fails on an undocumented route+verb, an enum that has drifted from its source,
an operation with no refusal, and a `required` naming a field that is not in
`properties`. `test/api-route-schemas.test.ts` fails on a route that reads a
body without publishing a schema.

**What the tests cannot check is whether the words are true**, and that is the
half that has been wrong most often: `Cost.category` said "free text" and is a
closed list; "published days in a trip" returns drafts too; the module comment
said "there are five endpoints" while describing thirty. The
`keep-the-contract` skill is the procedure for the parts a test cannot reach —
including driving a real journal onto a running instance, which is how B540
found two fields that were accepted, answered `201`, and thrown away.

