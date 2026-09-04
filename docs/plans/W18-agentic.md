# W18 — Skills, AGENTS.md, REST API, MCP

**Roadmap:** G1, G4, G5, G6, G7, G8 · **Depends on:** W06 · **Wave F**

> This is the differentiator (ROADMAP §7). Polarsteps can't say "your content is
> markdown in a folder you own and any agent can read and write it."

## Scope

### G1 — skills first, they're cheap and immediately useful ✅
`.claude/skills/`: `add-a-day`, `add-a-trip`, `ingest-photos`,
`write-from-voice-memo`, `generate-photobook`, `deploy`. Plus a real `AGENTS.md`
describing the content model. **Best demo of the agentic pitch, lowest cost.**

**Shipped**, with `send-postcards` in place of `write-from-voice-memo` — the
voice-memo pipeline is G2 and does not exist yet, so a skill for it would have
been a document describing nothing. Each was executed end to end before it was
written down.

### G4 — REST API (build before MCP; MCP is a client of it)
Trips, days, media, search. Token auth, per-token scopes, idempotency keys on
writes, rate limits. OpenAPI document generated.

### G5 — remote MCP server ✅
**Streamable HTTP** (SSE-only is legacy). **OAuth 2.1 + PKCE**; server acts as a
resource server, publishes `/.well-known/oauth-protected-resource` (RFC 9728),
and **must not forward the client's token downstream**. Tools: `list_trips`,
`get_day`, `create_day`, `attach_media`, `set_costs`, `search_entries`.
Read tools first; writes need idempotency because agents retry.

**Shipped** at `POST /api/mcp` (`lib/mcp/`), protocol revision 2025-06-18,
stateless. Tools: `list_trips`, `get_day`, `search_entries`, `list_drafts`,
`create_day`. `attach_media` and `set_costs` were deliberately not built —
photographs go through `npm run ingest`, which strips metadata an upload tool
would leak, and editing an existing file is a sharper risk than adding one.

**OAuth 2.1 is not implemented and is not claimed.** This is an OAuth resource
server validating tokens it issued itself; there is no authorization server, no
browser flow and no dynamic registration, and `authorization_servers` is absent
from the metadata rather than pointed at something invented.
`docs/providers/mcp.md` is the honest ledger, line by line.

### G7 — agent writes are always drafts
`status: draft` frontmatter + a review queue. **Never let a generated entry
publish itself.** One hallucinated memory in front of family is unrecoverable.

### G6 — direct file access
WebDAV or S3-ish view of the content folder, so "point Claude at my trip folder"
works with no API at all. Cheap, and very on-brand.

**Not built.** It is the lowest-value item here and the only one that hands out
raw filesystem access, which needs its own thinking about visibility and about
the draft rule — neither of which a WebDAV mount enforces. Still open.

## Acceptance
- [x] Each skill executed end to end at least once
- [x] API: writes idempotent under retry; rate limits enforced —
      **OpenAPI is still missing**, and `/documentation.txt` links
      `/openapi.json`, which does not exist. Outstanding.
- [x] MCP: transport, discovery and scoping exercised over HTTP with real
      JSON-RPC (see `docs/providers/mcp.md`); no token pass-through, because
      there is no downstream at all. **Not run against Inspector**, and OAuth
      discovery is deliberately partial — the metadata document is published,
      the authorization server it would name does not exist.
- [x] A generated entry lands as a draft and cannot self-publish — enforced in
      `lib/entries.ts`, and tested through both doors
