# Remove MCP: Implementation Plan

**Goal:** Remove the MCP (Model Context Protocol) door entirely — the
`/api/mcp` endpoint, its RFC 9728 resource metadata, all ten-odd tools, and
every doc/test/comment that treats it as a live surface — leaving the REST
API (`/api/v1/...`) as the only agent-write path. Nothing about REST changes
except one import path. This is a removal, not a redesign: MCP may come back
later, and this plan does not close that door, it just stops paying for it
today.

**Why now:** MCP has no client exercising it in production and costs real
surface — its own transport layer, its own auth/rate-limit branch, 2,184
lines of tool definitions duplicating REST logic, 1,829 lines of tests, a
whole doc file, and mentions scattered across ~20 other docs and a dozen
task files. The owner's call: it's overhead with no user right now.

**Architecture:** Six phases, done in this order because later phases assume
earlier ones are done — you cannot delete `lib/mcp/` while a REST route still
imports from inside it (Phase 1), and you cannot trim the doc-generator
prose usefully before the code it describes is gone (Phase 4 depends on
Phase 2's deletions being real, not just planned).

**Spec:** This file. There is no separate design doc — the removal is
mechanical, not architectural.

## Global Constraints

- **Verify with all four gates after every phase, not just at the end:**
  `npm run build && npx tsc --noEmit && npx eslint . && npx vitest run`. The
  build must run first — it writes `.next/types` — per `AGENTS.md`.
- **One task, one branch, one worktree.** Follow `work-on-a-task`: take this
  from `open/` only after a person promotes it, build in
  `.claude/worktrees/<id>-remove-mcp`, stop at `testing/`.
- **Do not touch `docs/plans/*.md` or `docs/security/2026-09-04-sweep.md`.**
  They are dated, historical records of intent/findings as they stood when
  written — not corrected to match what shipped later. MCP existed when
  those were written; that is what they should keep saying.
- **Do not mass-edit historical task files.** Dozens of `completed/` and
  `backlog/` tasks mention MCP in passing ("shared with REST and MCP",
  "the MCP tool too") as part of describing a fix that happened to touch
  both doors. Their REST-side content stays correct regardless of whether
  MCP still exists — leave that prose alone. Phase 6 below names the small,
  specific set of tasks that actually become **moot** (not just mentioning
  MCP, but *about* MCP) and need a person's attention, and stops there.

---

## Phase 1 — Relocate the one genuinely shared piece

`lib/mcp/idempotency.ts` implements `create_day`'s idempotency-key mechanism.
It is imported by exactly one file outside `lib/mcp/` —
`app/api/v1/[user]/trips/[trip]/days/route.ts:7` — and that route's own
comment says so: *"the mechanism is not MCP's"*. Move it before anything in
`lib/mcp/` is deleted, or REST's `create_day` idempotency breaks.

- [ ] **Step 1: Move the file**

  ```bash
  git mv lib/mcp/idempotency.ts lib/idempotency.ts
  ```

- [ ] **Step 2: Fix the one surviving import**

  `app/api/v1/[user]/trips/[trip]/days/route.ts:5-7` currently reads:

  ```ts
  // Shared with MCP's create_day. The module lives under lib/mcp/ because that
  // is where it was needed first; the mechanism is not MCP's.
  import { fingerprintOf, idempotencyKey, recall, remember } from "@/lib/mcp/idempotency";
  ```

  Replace with:

  ```ts
  import { fingerprintOf, idempotencyKey, recall, remember } from "@/lib/idempotency";
  ```

  (The comment explaining *why* it lived under `lib/mcp/` no longer applies
  once it doesn't — drop it rather than rewording it.)

- [ ] **Step 3: Verify nothing else references the old path**

  ```bash
  grep -rn "lib/mcp/idempotency" --include="*.ts" --include="*.tsx" .
  ```

  Expected: no output (the only other two hits, in `test/mcp.test.ts` and
  `test/mcp-create-journal.test.ts`, are deleted whole in Phase 3, and
  `lib/mcp/tools.ts`'s own import is deleted with that file in Phase 2).

- [ ] **Step 4: Commit**

  ```bash
  git add lib/idempotency.ts lib/mcp/idempotency.ts "app/api/v1/[user]/trips/[trip]/days/route.ts"
  git commit -m "Move idempotency.ts out of lib/mcp/ before removing MCP"
  ```

---

## Phase 2 — Delete the MCP-only code

Everything here exists for MCP and nothing else. Delete outright:

- [ ] `app/api/mcp/route.ts` (17 lines — the route itself)
- [ ] `app/api/well-known/oauth-protected-resource/route.ts` (24 lines — RFC
      9728 metadata, exists only so an MCP client can discover the resource)
- [ ] `lib/mcp/http.ts` (235 lines — Streamable HTTP transport, bearer auth,
      the `"mcp-auth"` rate-limit bucket, origin checks)
- [ ] `lib/mcp/server.ts` (206 lines — JSON-RPC dispatch, `initialize`,
      `tools/list`, `tools/call`)
- [ ] `lib/mcp/tools.ts` (2,184 lines — every tool: `list_trips`, `get_day`,
      `search_entries`, `list_drafts`, `create_day`, `edit_day`,
      `publish_day`, `create_trip`, `create_invite`, `list_invites`,
      `revoke_invite`, `set_journal_features`, `add_media`, and the
      `toolsFor`/`callTool`/`scopeAllows`/`reachableTrips` machinery)
- [ ] The now-empty `lib/mcp/` directory

```bash
git rm app/api/mcp/route.ts
git rm app/api/well-known/oauth-protected-resource/route.ts
git rm lib/mcp/http.ts lib/mcp/server.ts lib/mcp/tools.ts
rmdir lib/mcp
```

- [ ] **Drop the OAuth-metadata rewrites in `next.config.ts:136-146`** — they
  exist only to route `/.well-known/oauth-protected-resource*` to the file
  just deleted:

  ```ts
  // DELETE this whole block (check the surrounding rewrites() array syntax —
  // remove the two entries, keep the array valid):
  {
    source: "/.well-known/oauth-protected-resource",
    destination: "/api/well-known/oauth-protected-resource",
  },
  {
    source: "/.well-known/oauth-protected-resource/:path*",
    destination: "/api/well-known/oauth-protected-resource",
  },
  ```

- [ ] **Run the build to confirm nothing else imports the deleted files:**

  ```bash
  npm run build
  ```

  Expected failures if anything was missed: a module-not-found error naming
  the importer — fix forward by removing that import too (see Phase 4/5 for
  the known ones).

- [ ] **Commit**

  ```bash
  git add -A
  git commit -m "Delete the MCP transport, server, and tool implementations"
  ```

---

## Phase 3 — Delete/trim the tests

- [ ] **Delete whole:**
  - `test/mcp.test.ts` (1,668 lines — the full protocol suite)
  - `test/mcp-create-journal.test.ts` (161 lines)

  ```bash
  git rm test/mcp.test.ts test/mcp-create-journal.test.ts
  ```

- [ ] **Trim `test/journal-features.test.ts`:**
  - Line 11: remove `import { callTool } from "@/lib/mcp/tools";`
  - Lines 148-157: remove the whole
    `test("and through MCP, because the two doors are the same operation")`
    block
  - Lines 447-457: remove the whole
    `test("MCP does not offer them either — the schema has no property for them")`
    block (this one has its own inline `import { toolsFor } from "@/lib/mcp/tools"`
    — remove that import line too)
  - Line 310: drop the comment-only MCP mention

- [ ] **Rewrite the two MCP-dependent assertions in `test/agent-interface.test.ts`:**

  Lines 426-430 currently slice the guide at a heading that Phase 4 deletes:

  ```ts
  test("documents idempotency_key for REST, not only for MCP", () => {
    const guide = agentGuide();
    const restSection = guide.slice(0, guide.indexOf("## The same thing as MCP"));
    expect(restSection).toContain("idempotency_key");
  });
  ```

  Replace with:

  ```ts
  test("documents idempotency_key for REST", () => {
    expect(agentGuide()).toContain("idempotency_key");
  });
  ```

  Lines 553-559 assert the doc names MCP and cites B260 (which Phase 6 makes
  moot):

  ```ts
  test("names the two real doors, and does not overclaim the MCP one", () => {
    const summary = instanceDocumentation();
    expect(summary).toMatch(/arbitrary\s+HTTP\s+request/i);
    expect(summary).toContain("/api/mcp");
    expect(summary).toMatch(/connector/i);
    // B260 is the gap, not the fix — a connector still needs a hand-carried token.
    expect(summary).toContain("B260");
  });
  ```

  Replace with an assertion that fits what Phase 4 leaves behind (one door,
  not two — check the actual rewritten prose once Phase 4 is done and adjust
  the regex if needed; the shape should be roughly):

  ```ts
  test("names the one real door", () => {
    const summary = instanceDocumentation();
    expect(summary).toMatch(/arbitrary\s+HTTP\s+request/i);
    expect(summary).not.toContain("/api/mcp");
  });
  ```

- [ ] **Run the suite, expect only these files' tests to have changed count:**

  ```bash
  npx vitest run
  ```

- [ ] **Commit**

  ```bash
  git add -A
  git commit -m "Remove MCP tests; update the two assertions that depended on MCP prose"
  ```

---

## Phase 4 — Trim the agent-facing doc generator

`lib/api/documentation.ts` backs `/agent.md`, `/documentation.txt`, and
`/<user>/documentation.txt`. Four spots:

- [ ] **`instanceDocumentation()`, lines 82-86** (inside a `wrap(...)` call
  describing the two doors):

  Current:
  ```ts
  "Two doors actually do it: a harness or client that can send an arbitrary " +
    `HTTP request with a header of its own choosing, or ${base()}/api/mcp added ` +
    "as an MCP connector — though a connector still needs its owner to hand it " +
    "a token by hand today; nothing here issues one to a connector on its own " +
    "(tracked, not fixed, as B260).",
  ```

  Replace with (one door, no B260 reference — B260 is moot per Phase 6):
  ```ts
  "One thing actually does it: a harness or client that can send an " +
    "arbitrary HTTP request with a header of its own choosing.",
  ```

- [ ] **`instanceDocumentation()`, lines 305-309** (the "Machine-readable"
  list):

  Delete these two lines entirely:
  ```ts
  `- [MCP endpoint](${base()}/api/mcp): the same operations as MCP tools, over Streamable HTTP`,
  `- [Resource metadata](${base()}/.well-known/oauth-protected-resource): RFC 9728, for an MCP client`,
  ```

- [ ] **`userDocumentation()`, line 386:**

  Delete:
  ```ts
  `- [MCP](${base()}/api/mcp): the same operations as tools — list_trips, get_day, search_entries, list_drafts, create_day, edit_day, publish_day`,
  ```

- [ ] **`agentGuide()`:**
  - Line 986: `**\`idempotency_key\` works here, not only over MCP.** Send one on every write.`
    → `**\`idempotency_key\` works here.** Send one on every write.`
  - Line 1218: `Over MCP the same thing is \`add_media\`, taking base64 — fine for a handful, but` — delete this sentence/clause (check the surrounding paragraph reads cleanly once removed)
  - Line 1322: `plausible shape. Over MCP the same thing is \`get_day\`, which now returns drafts` → `plausible shape.` (drop the MCP clause, keep the rest of the sentence's point about reading your own work back)
  - **Lines 1325-1370: delete the entire `## The same thing as MCP` section**, from the heading down to (not including) the next heading `## A folder of photographs, all at once`. This includes the tool table, the JSON-RPC example, and the idempotency-parity paragraph (which is redundant with line 986's fix above).

- [ ] **Run the doc-generator tests:**

  ```bash
  npx vitest run test/agent-interface.test.ts
  ```

- [ ] **Commit**

  ```bash
  git add lib/api/documentation.ts
  git commit -m "Stop advertising MCP in the generated agent docs"
  ```

---

## Phase 5 — Comment-only mentions in otherwise-unrelated code

These are prose comments in files whose actual logic is unaffected — REST
(and, in two cases, `npm run ingest`) already does the described thing on
its own; the comment just used to name MCP as sharing it. Each is a small,
mechanical edit: drop the MCP clause, keep the sentence's real point.

| File:line | Current | Change to |
| --- | --- | --- |
| `lib/api/entries.ts:640` | "One function, because REST and MCP report the same act and a sentence kept…" | "One function, because a sentence kept in two files disagrees with itself within a month…" |
| `lib/api/media.ts:355` | "…nothing for an agent to act on, while MCP's path answered the same bytes with a usable error." | "…nothing for an agent to act on." |
| `lib/entries.ts:19` | "…its permalink went on answering 200 and MCP went on returning its full text until the server restarted." | "…its permalink went on answering 200 until the server restarted." |
| `lib/grants.ts:34` | "…and neither REST nor MCP takes an expiry…" | "…and REST takes no expiry…" |
| `lib/ingest/index.ts:466` | "B119 made `createDraft` refuse that, which covers REST and MCP; ingest writes its own names and did not." | "B119 made `createDraft` refuse that; ingest writes its own names and did not." |
| `lib/journals.ts:55` | "the two doors that reach it in production, `POST /api/v1/journals` and the MCP `create_journal` tool, both refuse…" | "the caller in production, `POST /api/v1/journals`, refuses…" (check the surrounding sentence's grammar after this — was plural, becomes singular) |
| `lib/slug.ts:12` | "The REST route, the MCP tool and `npm run ingest` all call it…" | "The REST route and `npm run ingest` both call it…" |
| `lib/validate/entry.ts:4` | "…lets the REST route, the MCP tool and `npm run ingest` all call the same checks…" | "…lets the REST route and `npm run ingest` call the same checks…" |
| `lib/validate/entry.ts:69` | "'content' is what the REST route and MCP tool call it." | "'content' is what the REST route calls it." |
| `lib/validate/media.ts:8` | "Photographs never arrive through the REST API or MCP…" | "Photographs never arrive through the REST API…" |
| `proxy.ts:15` | "…the documentation file, the feeds, the sitemap, OG metadata, the REST and MCP paths." | "…the documentation file, the feeds, the sitemap, OG metadata, the REST paths." |
| `app/api/v1/[user]/config/route.ts:53` | "Over MCP the same line falls out of the shape: `set_journal_features` and `set_journal_profile` are two…" | Rewrite the sentence to describe REST alone — read lines 48-56 in full before editing, this one needs the surrounding paragraph read for sense, not a mechanical strike. |
| `app/api/v1/[user]/trips/[trip]/days/[slug]/publish/route.ts:110` | "…it is the receipt now, and it is still shared with the MCP tool so the two doors cannot drift. B158." | "…it is the receipt now. B158." |
| `app/api/v1/[user]/trips/[trip]/days/route.ts:30` | "…and /agent.md promises they 'answer as if it did not exist'. MCP already did this correctly." | "…and /agent.md promises they 'answer as if it did not exist'." |
| `app/api/v1/[user]/trips/[trip]/days/route.ts:88-99` | The `idempotency_key` comment block explains the mechanism partly in terms of parity with MCP ("the same mechanism MCP's `create_day` has", "It was documented only under MCP…", "Shared with the MCP path rather than reimplemented…") | Rewrite to explain the mechanism on REST's own terms — what it does and why, without the "the other door already had this" framing. Read the full block (already quoted in Phase 1 context) before rewriting; don't mechanically strike clauses here, the paragraph's logic depends on them. |

- [ ] **After editing, grep to confirm only the two accepted exceptions remain
  in code:**

  ```bash
  grep -rn "MCP\|mcp" --include="*.ts" --include="*.tsx" lib app | grep -v node_modules
  ```

  Expected: no output. (If `.claude/skills/apply-the-brand/favicon-check.mjs`
  shows up in a broader grep, leave it — that's the unrelated
  chrome-devtools-mcp browser-automation plugin, not this feature.)

- [ ] **Commit**

  ```bash
  git add -A
  git commit -m "Drop MCP mentions from comments in code REST already owns outright"
  ```

---

## Phase 6 — Docs, and the tasks that become moot

### Delete

- [ ] `docs/providers/mcp.md` (227 lines — the whole provider doc)

### Edit

- [ ] **`AGENTS.md`** — lines 23, 36, 41, 439, 447. Drop `/api/mcp` from the
  "network doors" table (line 23), the `docs/providers/mcp.md` citation, and
  the `create_invite`-over-MCP owner-only note (rewrite to describe REST's
  own owner-only scoping instead of contrasting it with MCP's).
- [ ] **`README.md`** — line 17 (rewrite the sentence naming MCP as one of two
  doors), line 159 (table row: `MCP, and the print providers` →
  `the print providers`).
- [ ] **`docs/README.md`** — line 16 (same table-row fix as above), lines
  31-32 (currently explain that `providers/mcp.md` is what `AGENTS.md` cites
  — rewrite once both are gone; don't leave a sentence explaining a citation
  to a file that no longer exists).
- [ ] **`docs/architecture.md`** — line 47. Table row `lib/api/ · lib/mcp/ |
  the REST surface under /api/v1 and the MCP server at /api/mcp, over one
  shared core` → drop the `lib/mcp/` half, describe `lib/api/` alone.
- [ ] **`docs/runbook.md`** — line 148. Drop the `/api/mcp` half of "an agent
  writing a draft over `/api/v1` or `/api/mcp` writes into that same…".
- [ ] **`docs/running-locally.md`** — line 184. Drop the `/api/mcp` mention
  alongside `/agent.md`.
- [ ] **`docs/TESTING.md`** — line 15. Drop "MCP" from the list of surfaces
  the E2E suite covers.
- [ ] **`docs/qa/SCENARIOS.md`** — line 5 (drop "MCP" from the intro list),
  and delete **section J** whole (lines 179-190, all seven scenarios
  J1-J7). Leave the lettering gap — sections aren't renumbered elsewhere in
  this repo when one is cut (check `docs/qa/SCENARIOS.md`'s own history if
  unsure; if every other section *is* contiguous, relettering K-O down by
  one is a mechanical follow-up, not optional).
- [ ] **`.claude/skills/add-a-trip/SKILL.md:132`** — drop the "...or
  `create_trip` over MCP" clause.
- [ ] **`.claude/skills/add-a-day/SKILL.md:114`** — drop the
  `tools/call create_day (MCP — see docs/providers/mcp.md)` example line.
- [ ] **`docs/ROADMAP.md`, §7 (lines ~254-255)** — currently: "G1 (skills +
  `AGENTS.md`), G4 (REST), G5 (MCP), G6 (direct file access) and **G7 —
  agent-written content is always a draft** shipped in W18 and W23." Amend
  in place (this is a living decision log, not a frozen plan — other
  entries already carry inline amendments, e.g. decision 12 and 19 in §0):
  add a clause noting G5 (MCP) was removed on 2026-09-04 as unused overhead,
  naming whatever task id this plan ships under.

### Do not touch

- `docs/plans/*.md` (dated, historical — see Global Constraints)
- `docs/security/2026-09-04-sweep.md` (dated audit report — see Global
  Constraints)
- Every `completed/` task file mentioning MCP in passing

### Tasks that become moot

These are `backlog/`/`testing/` tasks *about* MCP specifically, not just
mentioning it — building them as scoped would describe fixing code that no
longer exists. This plan does not close them (`completed/` is a person's
gate, always, per `AGENTS.md` and `manage-tasks`). It only flags them, here,
for a person to close once this removal merges:

- [ ] **B260** (`testing/`) — "the MCP resource advertises no authorization
  server" — entirely about the RFC 9728 metadata endpoint deleted in Phase 2.
- [ ] **B175** (`testing/`) — "create_trip over MCP cannot ask for an
  unadvertised trip" — entirely about a tool deleted in Phase 2.
- [ ] **B206** (`testing/`) — "MCP create_trip cannot set listed" — same.
- [ ] **B112** (`backlog/`) — "local scripts bypass the token, draft status
  and rate limits every network write goes through" — this one is **not**
  fully moot (the underlying concern about local scripts bypassing REST's
  checks stands), but its body currently says "MCP/API" throughout; a person
  (or the task's own next builder) should reword it to "the API" before it's
  worked, so nobody builds half a fix against a door that isn't there.

Every other task the inventory turned up (B01, B05, B11, B15, B22, B33, B38,
B42, B89, B97, B98, B101, B103, B107, B113, B116, B119, B134, B141, B153,
B155, B156, B157, B158, B178, B182, B183, B204, B207, B220, B223, B224,
B228, B230, B240, B245, B259, B262, B263, B275, B277, B293, B295, and
others) mentions MCP only as context for a fix that is, or was, primarily
about REST or a shared function. Leave those alone — see Global Constraints.

- [ ] **Commit the docs/skills edits**

  ```bash
  git add -A
  git commit -m "Remove MCP from docs, skills and the roadmap's decision log"
  ```

---

## Final verification

- [ ] `npm run build && npx tsc --noEmit && npx eslint . && npx vitest run` —
  all four green.
- [ ] `grep -rn "mcp" --include="*.ts" --include="*.tsx" --include="*.md" . | grep -v node_modules | grep -v "docs/plans/" | grep -v "docs/security/" | grep -v "docs/tasks/completed/" | grep -v "chrome-devtools"` —
  review whatever remains; it should be limited to the "leave alone"
  categories above (backlog/testing tasks not yet edited per the "do not
  mass-edit" rule, and B112 flagged above).
- [ ] `curl -i http://localhost:3000/api/mcp` against a local `next start` —
  expect 404, not 405 or an auth challenge (confirms the route is gone, not
  just broken).
- [ ] `curl -i http://localhost:3000/.well-known/oauth-protected-resource` —
  expect 404.
- [ ] Confirm `/agent.md` and `/documentation.txt` no longer mention MCP:
  `curl -s http://localhost:3000/agent.md | grep -i mcp` — expect no output.

## Task-file acceptance (for whoever builds this from `docs/tasks/`)

- `POST /api/mcp` and `GET /.well-known/oauth-protected-resource` both 404.
- The full four-gate verification passes.
- `/agent.md`, `/documentation.txt` and `/<user>/documentation.txt` mention
  only REST as the agent-write path.
- `lib/idempotency.ts` exists; `lib/mcp/` does not.
- B260, B175 and B206 are named in the merge/testing note for a person to
  close.
