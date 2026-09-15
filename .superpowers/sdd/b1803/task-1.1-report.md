# Task 1.1 report — a route that serves a staged photograph

## What was built

`app/api/helper/[user]/extract/thumb/[run]/[id]/route.ts` — `GET`, serving a
resized WebP derivative of one photograph still in
`content/<user>/staging/<run>/files/`. Modelled directly on
`app/api/helper/[user]/inbox/[id]/thumbnail/route.ts`.

Supporting change: `lib/staging/store.ts` gained `stagedFileLocation(username,
runId, id)`, a sibling of the existing `readStagedFile` that returns the
resolved **path** instead of the bytes. This was necessary and not optional —
`readStagedFile` returns a `Buffer`, but `resizedCopy` (`lib/media.ts`) takes
a file path: it `fs.statSync`s the file itself and builds its cache key from
the file's own mtime/size, so handing it bytes (or a bytes-derived temp file)
would either not compile or would break the cache-key/dedup story `resizedCopy`
depends on. I factored the shared path-resolution logic — `runDir(...)` +
`path.basename(id)` — out of `readStagedFile` into a private `stagedFilePath`
helper, and both `readStagedFile` and the new `stagedFileLocation` call it.
This is the smallest change that keeps the guard logic in exactly one place
rather than duplicated inline in the route.

**Finding for the plan:** the brief says "`readStagedFile(username, runId,
id)` is the lookup," but `readStagedFile` alone cannot back this route —
`resizedCopy` needs a path, not a `Buffer`. I did not invent a workaround
(e.g. writing bytes to a scratch temp file, which would have broken
`resizedCopy`'s stat-based cache key and left orphaned temp files); I added
the smallest possible sibling function reusing the same validated path logic.
Flagging this in case later tasks in the plan also assume `readStagedFile`
returns something path-shaped.

## Guard-by-guard comparison against the inbox route

| Guard | Inbox route | This route | Reproduced / adapted |
|---|---|---|---|
| Capability gate | none (inbox has no `isEnabled` gate — it's not behind a capability) | `isEnabled("extract", user)` → 404 first | **Added**, per the brief's explicit requirement (`extract` is capability-gated; inbox is not, so there was nothing to copy here — this is a real difference in what the two features are). |
| Owner check | `isHelperOwner` → `notYourJournal(request, user)` | identical | **Reproduced verbatim.** Cookie only, same 404-not-403 shape. |
| Id resolved through lookup, not string-joined | `findInboxFile(user, id)` (does `path.basename(id)` internally) | `stagedFileLocation(user, run, id)` (does `path.basename(id)` internally, via the shared `stagedFilePath`) | **Reproduced**, same shape — a lookup function owns the traversal guard, the route never joins a path itself. |
| Different journal's real id → 404 | Falls out of `inboxDir(username, kind)` always being scoped to `username` | Falls out of `runDir(username, runId)` always being scoped to `username` (`lib/staging/paths.ts`) | **Reproduced** — same "falls out of the path arithmetic" property, verified by the "another journal's real run id resolves to nothing" test. |
| Traversal impossible by construction | `path.basename(id)` in `findInboxFile` | `path.basename(id)` in `stagedFilePath`, **plus** `runDir`'s `segment()` regex validation on `runId` (inbox has no second free-form path segment to validate — this route does, since the id is scoped by both `run` and `id`) | **Adapted**: one extra layer inbox doesn't need, because this route has an extra caller-supplied segment (`run`) that inbox doesn't. `segment()` throws on a bad run id (e.g. one containing `/`); the route catches that throw and maps it to the same 404. |
| Derivative, never original | `resizedCopy(found.file, width)` | `resizedCopy(file, width)` | **Reproduced verbatim.** |
| `private, no-store` | yes | yes | **Reproduced verbatim**, same header set including `X-Content-Type-Options: nosniff`. |
| Video / unresizable format | `resizedCopy` returns `null` for HEIC/video via its `RESIZABLE` allow-list; route 404s | identical — no special-casing added | **Reproduced verbatim.** Confirmed `lib/media.ts`'s `RESIZABLE` set (`.jpg .jpeg .png .webp .avif .gif`) excludes both HEIC and video extensions, so a `.mov` in staging 404s the same way a HEIC inbox file does — no ffmpeg, no poster frame, nothing invented. |

Nothing in the inbox route needed a guard this route couldn't replicate; the
capability gate is the one addition, required by the brief and by `extract`
being an opt-in capability (inbox has none).

## Tests — RED then GREEN

`test/extract-thumb.test.ts`, four required cases plus one (video → 404,
alongside the owner-success case; both are the "owner" describe block):

1. **owner gets image bytes, `private, no-store`** — PASS
2. **video has no still (404)** — PASS
3. **stranger signed in as someone else → 404, never 403** — PASS
4. **another journal's real run id resolves to nothing under this username**
   — PASS
5. **traversal id collapses and finds nothing** — PASS

RED: confirmed by moving `app/api/helper/[user]/extract/thumb/` aside and
rerunning — the suite failed with `Cannot find package
'@/app/api/helper/[user]/extract/thumb/[run]/[id]/route'` (1 failed suite, 0
tests run), then restored.

GREEN: `npx vitest run test/extract-thumb.test.ts` → `Test Files 1 passed (1)
/ Tests 5 passed (5)`.

## Bugs found and fixed along the way

- My first draft of `stagedFilePath`'s extraction accidentally moved the
  `runDir(...)` call for `readStagedFile` *inside* its own `try`/`catch`,
  which swallowed the `segment()` validation throw instead of letting it
  propagate. `test/staging-store.test.ts`'s existing keeper ("a run id
  refuses a path separator") caught this immediately on `npm run verify` —
  fixed by moving the path computation back outside the `try`, matching the
  original function's structure.
- `test/helper-routes.test.ts`'s route census ("there are fifty-five of them")
  needed bumping to fifty-six, with a new comment line, since this is a real
  new guarded route under `app/api/helper/`.

## Files changed

- `app/api/helper/[user]/extract/thumb/[run]/[id]/route.ts` (new)
- `lib/staging/store.ts` (added `stagedFileLocation`, factored out
  `stagedFilePath`)
- `test/extract-thumb.test.ts` (new)
- `test/helper-routes.test.ts` (census bump 55 → 56, one comment line)

## Verify

`npm run verify` (foreground, `timeout: 900000`, `VERIFY_WILL_WAIT=1`): build,
TypeScript, ESLint, Vitest (634 files, 7951 passed, 4 skipped — pre-existing
Postgres-dump skip, unrelated), knip — all green.

## Concerns

- No UI strings were added (this is a pure API route with no user-facing
  text), so the brief's i18n requirement doesn't apply to this task.
- Not browser-verified at 390px, because this task has no page — it is
  consumed by later tasks in the plan (the photograph pane). That verification
  belongs to whichever task first renders an `<img>` against this URL.
- `stagedFileLocation` is new public surface on `lib/staging/store.ts`; it's
  a pure read-only existence-check + path-resolution, no new write path, so I
  judged it in scope as "the same lookup, differently shaped" rather than
  scope creep — but flagging it since the brief named only `readStagedFile`.
