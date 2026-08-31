# W36 — Fixing what the black-box runs found

Everything still open from the three QA runs of 30–31 August 2026 — one
scenario pass and two black-box passes — grouped by what is actually wrong
rather than by who reported it. The run reports themselves were working output
and have been deleted now that this is done; what they found is below.

Ordered so that the things a reader or an owner is harmed by come first, and so
that fixes which plausibly resolve several reports at once come before the
individual reports they might explain.

---

## A — The privacy promise does not reach everything · first

The product has one rule and two edges where it stops holding.

**A1. ✅ A draft's photographs are public.** `POST …/media` writes into
`media/<day>/` and the file is served by path. Trip visibility gates it; the
entry's own state does not. So an agent that writes a day and attaches the
pictures has published the pictures, and they survive the draft's deletion.

*Fix:* the media route resolves the day and refuses when it is a draft, or
serves drafts' media only to the owner. The second is better — an owner
reviewing a draft needs to see its photographs — so `resolveMediaFile` grows
the same `includeDrafts` question the entry readers already answer.

**A2. ✅ Making a trip private does not reach the feed.** `feed.xml`,
`sitemap.xml` and `search-index.json` are prerendered, so the page locks
immediately while RSS keeps publishing every day's full text until somebody
rebuilds. The same staleness hides a *published* day from those surfaces, which
is the harmless direction of one bug.

*Fix:* make the three dynamic, with a short cache header. They are cheap —
one pass over entries already in memory — and "no runtime service" was never
worth a privacy setting that does not take effect. Note in `docs/runbook.md`
that a rebuild is no longer needed to change visibility.

**A3. ✅ Deleted and orphaned media.** Deleting a day leaves its photographs
served, and `POST …/media` accepts a `day` slug that does not exist, silently
creating public folders. Decide both deliberately: refuse an unknown slug, and
leave the photographs on delete but say so in the response.

## B — What a reader actually hits

**B1. ✅ The photo viewer's arrow keys close it and skip the day.** One press.
The viewer never takes the keyboard, so the keystroke also reaches the story
page's next-day shortcut. *Fix:* the viewer owns the keyboard while open —
move focus into it, `stopPropagation`, and restore focus on close. It also has
no `role="dialog"`/`aria-modal`, which is the same omission.

**B2. ✅ The service worker can answer a navigation with a photograph.**
`navigationFallback` returns the first cached entry whose first path segment
matches the journal, of any type. *Fix:* accept only HTML; fall through to
`/offline`. Suspected to also explain B3.

**B3. ✅ Language switching appears to do nothing.** Sets the cookie, changes no
text, survives a reload. Run 1 praised translation on the same code, so the
first suspect is B2 serving a cached copy rather than refetching. Re-test after
B2 before investigating further.

**B4 and B5. ✅ Reproduced, and one cause.** The 12 × HTTP 400 and the blank
thumbnails are both `next/image`: the optimiser re-fetches the source
server-side through a mocked request carrying no cookies, so a permission
check sees a stranger and refuses, and an empty body becomes a 400. Nothing
behind a gate could ever be rendered through it. The media route resizes its
own files now.

**B6. ✅ The day-by-day spend chart renders every bar at zero height.**

**B7. ✅ Does not reproduce against a current build**, and A2 explains why it
did. The index was prerendered and the entry cache outlived the file, so a day
written after the last build never reached `search-index.json` — the report's
own observation that the document *was* in the index fits a stale copy of it.
Checked directly: a new day now reaches search, the feed and the sitemap
within a second of being written, and leaves all three when deleted.

## C — Wording and small visible things

**C1. ✅** Two-part labels run together: "GroceriesMoab", "FuelBishop",
"CHF 1'016 4 Nächte". Three components, one missing separator.
**C2. ✅** Singular/plural: "1 trips", "1 Countries".
**C3. ✅** Untranslated: the browser tab title, and ~~the photo viewer's Close /
Previous / Next~~ (done alongside B1 — the viewer was being rewritten anyway).
**C4. ✅** "Days on the road" shows the entry count, not elapsed days.
**C5. ✅** The password gate and `/join` render with no header — no way back.
**C6. ✅** An already-approved reader signing in again is told to wait for
approval, and the flow files a fresh pending request.

## D — Documents that are not true

**D1. ✅** `/agent.md` says published days cannot be deleted through the API.
They can — deliberately, behind their own confirmation. Three testers reported
the contradiction; an agent that believes it will not ask a person first.
**D2. ✅** `/agent.md` contradicts itself on whether photographs go through the API.
**D3. ✅** `openapi.json` omits DELETE and the media endpoints, and its
`visibility` enum predates W27 (`unlisted`/`password` rather than
`private`/`public`/`guest`).
**D4. ✅** Video is advertised in the limits table and refused by the upload path.
Either implement it or stop advertising it.
**D5. ✅** "All metadata stripped" — served images keep resolution, colour space
and a stock photo's `UserComment`.

## E — Robustness

**E1. ✅ Does not reproduce.** Swept every JSON endpoint at 100 to 20 000
levels, arrays and objects, and in each entry field: 400 or a proper JSON-RPC
error everywhere, no 500. Either an earlier fix covered it or the original
report caught a shape not reconstructed here.
**E2. ✅** A mixed-batch media upload reports total failure while partially
writing, and the error's own advice duplicates files on retry.
**E3. ✅** MCP `idempotency_key` replays a stale result when the payload changes.
**E4. ✅** No way to read back a draft's full content through either door — both
the owner and the companion wanted it, to check before asking a person.

## F — Left over from the first QA pass

**F1. ✅** `/api/health` reports server-level capabilities only, so contacts can
read "enabled" while `/<user>/join` 404s.
**F2. ✅** A missing credential leaves the process up serving 500s rather than
exiting; under systemd that looks healthy.
**F3. ✅** `npm run export` writes into the repository root by default.
**F4. ✅** The contacts request API takes `wantsDigest` while everything else says
`wantsEmailDigest`.
**F5. ✅** The access panel says nothing about agent tokens.
**F6. ✅** `export.zip` ignores `Authorization` — safe, but it under-delivers
against its description.

> **Not code.** `severin-export.zip` is out of the index but still in git
> history; a public release needs that history rewritten or a fresh repository.
> Only you can decide that.

---

## Order

1. **A1, A2** — the privacy promise.
2. **B1, B2** — then re-test B3.
3. **D1–D3** — cheap, and actively misleading agents.
4. **A3, C1–C6** — the visible small ones.
5. **E, F** — robustness and leftovers.
6. **B4–B7** — investigate; they need reproduction first.

## Acceptance

Every fix carries a test that fails without it. The two privacy fixes carry a
black-box check as well: a draft's photograph must 404 for a stranger, and a
trip switched to private must leave the feed without a rebuild.

---

## Done — 2026-08-31

All of it, in seven commits. 924 tests, up from 880; `tsc`, `eslint` and
`next build` clean on each.

One finding did not reproduce (**E1**) and one turned out to be a symptom of
another (**B7**, which A2 explains). Both are recorded above with what was
actually checked rather than marked fixed.

Three things were found while fixing the reported ones, and each was worse than
the finding that led to it:

- **`next/image` cannot render anything behind a permission check.** The
  optimiser re-fetches the source through a mocked request carrying no cookies,
  so the gate refuses and an empty body becomes a 400. Every photograph on
  every non-public trip was a blank square, for its own travellers as much as
  for a stranger. Found under B4/B5, which were filed as "not yet reproduced".
- **A malformed video held a request open for four seconds** — twenty from a
  terminal — because ffprobe falls back to waiting on a standard input that
  `spawnSync` leaves open. A denial of service written in a default. Found
  while testing E2.
- **`poster` was the one media path nobody prefixed with the journal's owner**,
  so every ingested clip's still was a 404 on a multi-user instance. It had
  been written into frontmatter since videos existed and declared on no type,
  so nothing read it. Found under D4.

The `severin-export.zip` still in git history is unchanged and remains yours to
decide. `npm run export` can no longer put another one there.
