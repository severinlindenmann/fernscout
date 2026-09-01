# Archived documentation — unverified

Everything in this folder was written by an agent during the build and **has
never been reviewed by a person.** It was moved here on 2026-09-01 for that
reason alone, not because anything in it is known to be wrong.

**Treat it as useful, not as authority.** It may describe intentions that were
never built, decisions that were later reversed, or commands that have since
changed shape. If you rely on something here, verify it against the code first,
and fix the document while you are there.

Do not cite a file in this folder as the reason for a change. The code is the
authority; `AGENTS.md` at the repository root and the skills in
`.claude/skills/` are the maintained guidance.

## What was actually checked

On 2026-09-01, every `lib/ app/ scripts/ deploy/ content/ test/` path these
documents mention was resolved against the repository — about 117 references.
All of them resolve. The handful that looked stale were false positives:
`/var/lib/fernscout` matched as `lib/fernscout`, and `content/dev.db` and
`content/example/mail/` are gitignored files that exist only once you have run
the thing.

So the **paths** are accurate. Nobody has checked the **claims** — whether the
explanations are still true, whether the trade-offs described are the ones that
shipped. That is the open question, and it is why this folder exists.

`architecture.md` is the strongest of them: 40 path references, all resolving,
and its account of the module layout, `proxy.ts`, the baked world map and the
paged reading model was spot-checked against the code and held.

## Known consequence

Moving these files broke roughly 27 links that pointed at their old locations —
the docs table in `README.md`, several mentions in the root `AGENTS.md` and the
skills, and code comments in `next.config.ts`, `lib/db/` and `lib/contacts/`.
Tracked as B09 in `docs/tasks/`; fix the link rather than silently dropping it.

`docs/plans/` was removed in the same pass and is not in this folder. It is in
git history — `git show <sha>:docs/plans/INDEX.md` to read one, or
`git checkout <sha> -- docs/plans` to bring the lot back.
