# W41 — The file shape is published

`fernscout-helper` writes journals onto an instance and checks them before it
does. It was built on a principle it states plainly:

> These tools follow an instance rather than defining anything — types, enums,
> required lists and the upload limits all come from `<site>/openapi.json` and
> `<site>/api/health` at run time. What they do keep is the shape of the
> *files* — which keys a `trip.md` may carry, which of them never travel —
> because a contract about HTTP cannot describe that.

The principle has held on the side it covers. In a full day of finding bugs in
those tools, not one was a wrong type, a stale enum or an out-of-date upload
limit: all of that is fetched, so none of it can rot.

Every drift found was on the other side of that sentence.

- `model.mjs` said `coordinates` and `photos` are "only ever false". The
  server had gained a third answer, `"unknown"`, for both. Nothing was
  broken — the note is prose — but an agent reading it to learn what a day may
  say was told that *there were some and they are gone* is not sayable about
  photographs (B585).
- `config.json`'s `features` block was never checked for shape, so
  `"postcards": true` — refused by the server, silently reverted to off —
  validated clean. The repository's own "every option set" fixture carried
  exactly that and had believed itself opted in for as long as it existed
  (B598).
- Before either, the server gained `unrecorded: [costs]` beside
  `without: [costs]`. The tools did not know the key, and a good journal came
  back with two errors, both wrong. That one is written up in the helper's
  own `AGENTS.md` as the reason its self-test exists.

Three instances of one thing:

> **The file shape is the only part of the contract the server does not
> publish, so it is the only part that has to be copied — and a copy is a
> thing that drifts.** Everything published has stayed correct. Everything
> copied has rotted, at the speed the server changes.

Written before the work. Not corrected afterwards — see `docs/README.md`.

---

## What this is not

**Not a merge of the two repositories.** `fernscout-helper` is cloned by
people who will never run this server, and its rule that a clone needs no
`npm install` before somebody's photographs work is worth keeping. It stays
standalone and dependency-free.

**Not a validation endpoint.** Sending a person's unpublished journal to a
server to ask whether it is well-formed inverts the order the helper is built
around — it checks *before* anybody decides to publish, and it works with the
network down. Content stays on the laptop.

**Not a general rule engine.** The vocabulary below is closed on purpose, and
the escape hatch for anything that does not fit is a *named* check the client
implements and the manifest merely declares. A rule language that can express
anything is one nobody can debug, and it would be a second thing to keep in
step with `lib/validate/`.

---

## The document

A third published contract, beside the two that work:

```
GET <site>/openapi.json        what the API takes          (exists)
GET <site>/api/health          what this server offers     (exists)
GET <site>/content-model.json  what a journal on disk is   (new)
```

Public, unauthenticated, cached for a day by the client. It describes files,
not requests: which keys a `trip.md` may carry, which never travel over the
API, which the API takes but a file may not hold, and what each one is for in
words a person reads.

### The vocabulary is closed

One rule is an object. `assert` is one of exactly eight kinds:

| `assert` | Means |
| --- | --- |
| `type` | this value is a string / number / boolean / array / object |
| `enum` | one of these values |
| `pattern` | matches this anchored regular expression |
| `required` | this key must be present |
| `shape` | this object's named members have these types |
| `known-key` | no key here that is not declared |
| `never-in-file` | the API takes this; a file carrying it is describing a call |
| `never-over-api` | a file may carry this; it is never sent |

`path` addresses a key, with `*` for "every member of this map" — that is what
`features.*` needs and it is the only wildcard. `where` names the file. Nothing
else is executable, and that is deliberate: see **The client runs a stranger's
document**, below.

### Everything else is a named check

Cross-field rules — *a trip that tracks costs refuses a day silent about
them*, *a journal declaring two languages refuses a day without translations* —
do not fit eight assertions, and contorting them to fit is how the vocabulary
stops being closed. So they are not expressed at all. They are *declared*:

```jsonc
{ "id": "day-answers-tracked-fields", "kind": "named",
  "because": "needs the trip's tracks: and the day's without:/unrecorded: together" }
```

The client implements them by id. The manifest's job is to say **which ones
exist**, so that a client which has not implemented one can say so.

That is the whole reason this half exists. A named check the client does not
know is the exact situation that produced the `unrecorded:` incident, and it
must be visible:

> **A check that did not run must never look like a check that passed.**

It is the rule the rest of this plan is arranged around. A self-test that
skipped every fixture and exited `0` (B577), and a stale cache that quietly
dropped the photograph checks (B579) were both the same failure, and both were
found by accident rather than by anything reporting them.

### Version

`"contentModel": 1` at the top. A client that does not understand the major
version refuses to validate against the document and says so. It does not
guess, and it does not fall back silently.

---

## Staying true to `lib/validate/`

This is the part that decides whether the plan is worth doing, because the
obvious failure is to move the drift rather than end it: a published rule set
that disagrees with the validator the server actually runs is worse than a
copy in another repository, since both now live here and neither is obviously
wrong.

`lib/validate/*` is not refactored. It stays the server's own gate. The rule
set is authored beside it, and:

```
test/content-model.test.ts
```

runs both over the same fixtures and asserts they agree, rule by rule. It is
part of `npm run verify`, so the build fails the moment they part company.

Two implementations, provably in step, is a weaker claim than one
implementation — and it is the one worth buying here. Rewriting a tested
validator to be driven by a manifest is a large change to working code, and
the rules that do not fit the vocabulary would stay hand-written anyway, so
the "single definition" would not have been single.

---

## The client runs a stranger's document

`FERNSCOUT_URL` points wherever it is told. This document is fetched from that
host and used to inspect a private journal on somebody's laptop. So:

**The interpreter never evaluates anything.** No expressions, no code, no
regular expression used as anything but a match. A hostile or broken instance
must be able to produce wrong *findings* — annoying, visible — and never wrong
*behaviour*.

`pattern` is the one kind that takes something regex-shaped. It is anchored,
length-capped, and matched with a linear-time matcher or not at all.

---

## What stays on the client, permanently

The half no server can answer, because it cannot see the disk:

- every `gallery:` `src` exists, is a format the instance takes, is not empty
- `media/<slug>/` folders belonging to no day
- the filename's date against the frontmatter's, and both against the trip's
- two files sharing a slug
- dates inside the trip with no day at all

These are not in the manifest and are not the server's to declare. The client
owns them and always will.

`publish` needs almost nothing from this document. It is already an API client
following `openapi.json`, and its one drift — sending a create-only
`photos: false` on every update (B597) — is a gap in the contract it already
reads: `DayEdit` does not differ from `Draft` where the routes differ. B599
closes that. The only thing publish takes from the manifest is the mapping
that `without: [x]` means `x: false` and `unrecorded: [x]` means
`x: "unknown"`.

---

## Order

Each step leaves both repositories working, and nothing a user sees changes
until the last one.

1. **Publish the document**, derived from the helper's current `model.mjs`.
   A faithful copy: no behaviour changes anywhere, on either side.
2. **The conformance test goes in and passes.** This is where disagreements
   between the rule set and `lib/validate/` surface. B585 is already known to
   be one of them; expect others.
3. **The client gains the interpreter**, keeps `model.mjs` as a fallback, and
   reports which source it used.
4. **Rules cross over in batches.** Each batch is verified by the helper's
   three fixture journals producing identical findings before and after.
5. **`model.mjs` is deleted** when the fixtures produce identical output from
   the manifest alone.

Steps 1 to 3 are invisible to anybody using either tool. Step 5 is the only
one that cannot be undone by reverting a commit, and it is last for that
reason.

---

## Testing

Three levels, and neither repository tests the other's internals — the
manifest is the interface.

- **fernscout**: `test/content-model.test.ts`, the conformance test above. In
  `npm run verify`.
- **fernscout-helper**: `selftest.mjs` runs the three fixture journals through
  the interpreter against a **live** manifest. If an instance gains a rule the
  interpreter cannot execute, this is what says so. It became capable of
  saying anything at all in B577.
- **Both**: a rule that cannot be executed, a named check that is not
  implemented, and a manifest that cannot be read are each reported by name.
  There is a test for each of those three, because they are the ways this
  design fails quietly, and quiet failure is what it was built to end.
