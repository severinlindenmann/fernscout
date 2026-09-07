---
id: B662
title: Plaintext sign-in codes still reach the backup through content/.mail
type: SECURITY
priority: medium
complexity: low
area: backup, mail, content root
found: "2026-09-07T06:47:12Z"
started: "2026-09-07T07:04:29Z"
merged: "2026-09-07T07:12:29Z"
---

# B662 — Plaintext sign-in codes still reach the backup through content/.mail

## Why

**Corrected below — the original text of this section named only
`content/.mail/` and undersold what is actually exposed. The real finding is
wider: three shapes, not one, and one of them carries real addresses and
agent codes, not only short-lived signup codes.**

Found during B656's restore drill, in the restored tree itself:

```
dr/content/.mail/2026-09-05T17-37-41-075Z-agent-fernscout-ch-dein-code-fur-fernscout.eml
dr/content/.mail/2026-09-05T20-54-07-404Z-lindenmann-severin-io-your-code-to-start-a-journal-on-fernscout.eml
```

B636 moved sent mail out of `content/` and into `<dataDir>/mail/`, precisely so
that plaintext sign-in codes stop travelling in backups and exports. B653's
allowlist then excludes `<dataDir>/mail/` by simply not naming it.

**Production actually has three legacy shapes, all inside `content/` and
therefore all in every snapshot** — confirmed by walking the live server, not
only inferred from B656's drill:

```
content/.mail/                 signup codes for people who own no journal
content/example/mail/          a per-journal example
content/severin/mail/          one owner's own sent mail
```

The last of those is the one that matters most. It is not only short-lived
sign-in codes: it holds **real recipient email addresses, a journal-ready
mail, and one message titled `your-fernscout-agent-code`** — an agent
credential, not a one-time code that expires in thirty minutes. `content/.mail/`
and a per-user `content/<username>/mail/` are the same structural bug —
neither is named in `scripts/backup.sh`'s allowlist, and both are nested
inside `content/`, which is — so one fix has to cover both shapes.

The two files quoted above are pre-B636 leftovers and B636's legacy sweep
(`lib/mail/index.ts`) will remove *those particular files* within two days of
the instance's next send to that address. That does not make the bug small:
the sweep only runs when something is next written to the *same* directory,
so a `content/<user>/mail/` nobody has written to since before B636 sits there
untouched, and the backup path has no opinion of its own — the day the sweep
does not run (a quiet instance, a failed unit, a journal that has stopped
sending) the files stay and keep going into nightly snapshots.

A sign-in code is short-lived; an address a journal has actually mailed, and
an agent code, are not self-expiring in the same way. Held in backups kept for
thirty days, the practical exposure is: who this journal has contacted, at
which address, plus any agent or sign-in code caught in the same directory at
snapshot time. That is smaller than an account takeover and larger than "just
metadata".

## Work

- Exclude **both** legacy shapes from the staged tree in `scripts/backup.sh`,
  alongside the `postcards/`/`photobooks/` strip that already happens there —
  B653 found those needed code too, since they are nested inside `content/`
  rather than top-level: the top-level `content/.mail/`, and `mail/` nested
  under every `content/<user>/`.
- The directory names (`.mail`, and the per-user `mail/`) are defined in
  `lib/mail/index.ts` as `NO_JOURNAL_DIR` and the literal in `legacyMailDir()`.
  A shell script cannot import a TypeScript constant, so `scripts/backup.sh`
  names both by hand next to the `find` calls and says, in a comment, that
  they must be kept in step with `lib/mail/index.ts` by hand.
- Checked `lib/exportZip.ts`: `appendUserContent` walks only
  `path.join(root, "trips", trip.id)` for each trip plus `config.json` at the
  user root — it never calls `userDir()` on its own to walk the whole journal
  directory, so `content/<user>/mail/` (which sits beside `trips/`, not inside
  it) is not reachable through an export. Confirmed in code, not assumed;
  B636's belief holds.
- Checked what else walks the content root: `getAllMedia` (`lib/entries.ts`)
  reads media through each entry's own frontmatter rather than listing
  directories; `lib/media.ts` and `app/[user]/media/[...path]/route.ts` only
  ever resolve inside `tripMediaDir(ref)` (`content/<user>/trips/<id>/media/`),
  never the user root. Nothing else user-facing walks `content/<user>/`
  generically, so `mail/` sitting beside `trips/` is not picked up anywhere
  else either.
- Tests in `test/backup-script.test.ts`: both shapes seeded (top-level
  `content/.mail/` and `content/<user>/mail/`), each with a real `.eml`,
  asserting no `.eml` survives anywhere in the staged tree and that the
  journal's real content (`trips/`, and the rest of `content/<user>/`) is
  still staged beside the stripped directory.

Not doing: anything about where `content/.mail/` or `content/<user>/mail/`
lives, or forcing a migration on deployments that have not restarted since
B636. Moving mail out of `content/` is B636's territory and already
argued; this is only about the copy that outlives it in every snapshot until
it is swept or an operator cleans it up by hand.

## Acceptance

- A run with `content/.mail/` populated stages no `.eml`.
- A run with `content/<user>/mail/` populated stages no `.eml`, and the rest
  of that user's `content/<user>/` tree (`trips/`, etc.) still stages
  normally.
- `test/backup-script.test.ts` fails if either regresses.
