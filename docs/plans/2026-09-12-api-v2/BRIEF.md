# Fernscout v2 — area design brief (shared by all design agents)

You are designing one area of the complete v2 API for Fernscout, a
self-hostable travel journal (content = markdown + photographs in a folder
the author owns; an agent is the only thing that writes a day). This is a
CLEAN-SLATE redesign: do not carry a v1 route over because it exists —
design what the feature actually needs, and say what should die.

## Read first

- `/Users/severin/Documents/GitHub/fernscout/AGENTS.md` — in full (use
  bounded reads, sed -n 1,200p etc). It is the product's constitution.
- The already-designed v2 core, which your area must compose with:
  `/Users/severin/Documents/GitHub/fernscout/.claude/worktrees/b1587-api-v2-schemas/lib/api/v2/schemas/*.ts`
  (trip, day, journal, figures, media, status, shared). These are DECIDED —
  reviewed field by field by the owner. Do not redesign them; reference them.
- The v1 code for your area (routes under
  `/Users/severin/Documents/GitHub/fernscout/app/api/`, logic under `lib/`).
  Read enough to know every capability and every field that exists today —
  a feature you missed is a feature your design silently deletes.

## The decided design rules (non-negotiable)

1. **Document-oriented, few doors.** Whole resources as one JSON, read
   whole, written whole (or JSON Merge Patch). No per-field routes.
2. **Everything is asked-or-declined.** A section is brought, or named in
   `declined: {field: "reason"}` (free text, ≥10 chars). Silent omission →
   422 whose body lists every missing field with why_required, a schema
   excerpt, and how to decline. Plain optional ONLY for detail that rides
   another answer, or where absent is the overwhelming default.
3. **Conditional questions beat universal ones.** Ask a question only of
   the case it applies to; a question that does not apply is REFUSED if
   present, never ignored (e.g. teaser only on closed trips).
4. **One field, write and read.** No `*Resolved` twins: the read shape is
   the write shape plus server-owned truth in the SAME fields, distinguished
   by data. Server-owned fields are rejected in writes by the strict shape.
5. **One fact, one address.** Instance facts on GET /api/v2/status; journal
   standing on GET /api/v2/{user}/status; editable identity on the document.
   Never the same number in two places.
6. **Client-chosen ids everywhere**; retried create → 409 with the stored
   document. Exception: media src = hash of the bytes.
7. **One error envelope**: {error: <code from lib/api/errorCodes.ts>,
   message, details?}. Every refusal documented.
8. **Kill inert fields.** If nothing renders or computes it, cut it (and
   say so in the ledger).
9. **Safety shapes are untouchable**: draft-then-publish two calls; DELETE
   = 202 + mail to the owner; postcard send = owner's browser only,
   addresses never reach an agent; nothing an agent holds can grant credits;
   GPS store readable by no route; weather source rules; no invented
   content. You may re-house these behind cleaner doors, never weaken them.
10. **Server may act and inform**: the server may do something sensible on
    a decline (auto-pick, send a mail) but the echo must report it
    truthfully — "a mail is waiting", never "access granted".
11. **Structure for the future without shipping it** where a follow-up is
    already known.
12. **Enums are imported, never retyped** — name the source constant
    (file:symbol) for every enum you use.
13. **Four prefixes**: /api/v2 (bearer, the agent contract) · /api/web
    (cookie-only browser internals) · /api/auth · /api/webhooks. Say which
    prefix each of your routes lives under and which credential it takes.

## Your deliverable

Write ONE markdown file to the path given in your task. Structure:

1. **Inventory** — every v1 route + capability in your area (path, verb,
   what it does, who calls it). Completeness matters more than brevity.
2. **v2 design** — per resource:
   - purpose in 2-3 sentences; URL(s) + verbs + prefix + credential
   - **Edit schema**: table — Field | Type | Class
     (required / declinable / conditional / optional) | Notes. Spell out
     enums (with source constant), ranges, formats, decline semantics.
   - **Read schema**: the edit shape plus server-owned rows.
   - one example request + response (real-looking values, no lorem)
   - refusals: every error code this resource answers, and when
3. **Proposed cuts** — features/routes not worth carrying into v2, each
   with reasoning and what replaces it (or "nothing, retire it"). These are
   DECISIONS FOR THE OWNER — argue, don't decide.
4. **Migration ledger** — the legacy code this design touches: file paths
   to rewrite, split (validation half vs write half), or delete; which v1
   quirks die; what data migration (if any) existing journals need.
5. **Open questions** — anything genuinely the owner's call, with your
   recommended default.

Style: precise, complete, honest about tradeoffs. British-neutral prose like
AGENTS.md. Never invent a field the code doesn't support without marking it
NEW. Do not modify ANY repository file — your only write is your one
deliverable file in the scratchpad.
