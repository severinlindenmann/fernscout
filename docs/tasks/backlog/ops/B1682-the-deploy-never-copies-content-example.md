---
id: B1682
title: The deploy never copies content/example/figures, so a rebuilt box serves no demo journal
type: OPS
priority: high
complexity: low
area: ops
found: "2026-09-13T14:38:16Z"
---

# B1682 — The deploy never copies content/example/figures, so a rebuilt box serves no demo journal

## Why

`ship.sh` syncs exactly two paths of the demo journal into `CONTENT_DIR`:

```
$ grep -n "rsync" -A2 .claude/skills/vps/ship.sh
74:  sudo -u fernscout rsync -a --delete --itemize-changes \
76:    $APP_DIR/content/example/config.json $APP_DIR/content/example/trips \
```

The repository has a third path the demo needs:

```
$ ls content/example/figures/ | wc -l
16
```

`content/example/config.json` names `figures: ["agent", "priya"]`, and every
trip that uses `mode: "custom"` names figure ids. B1643 added that directory;
the deploy's sync list was never widened to match.

The consequence is live right now. With `figures/` absent from the box:

```
$ curl -s -o /dev/null -w '%{http_code}' https://fernscout.ch/example
404
$ ssh … 'journalctl -u fernscout | grep defaultUser'
[users] site.defaultUser is "example", but content/example is not a usable user.
```

So the demo journal — the acceptance fixture, the landing page's default user,
and the first thing any visitor sees — cannot be restored by a deploy. A box
that loses that directory stays broken however many times `ship.sh` runs, and
`ship.sh` reports success while it does.

The skill file calls `config.json` and `trips/` "the two paths the repository
owns". That was true when it was written and is not true now.

## Work

Add `content/example/figures` to the rsync source list in `ship.sh`, and
correct the sentence in `.claude/skills/vps/SKILL.md` that says two paths.

Better than listing paths: sync `content/example/` and exclude the four the
server owns (`originals/`, `.ingest.json`, `mail/`, `postcards/`,
`photobooks/`). An allowlist that must be widened by hand every time the
fixture grows is the thing that just failed; a denylist of the server's own
paths cannot silently omit a new one.

`ship.sh` and the `vps` skill are gitignored and instance-local, so this is
not a repository change — but the same gap exists for anybody else's deploy
script, which is worth a sentence in `docs/` where the demo sync is
described.

## Acceptance

- `ssh … 'ls /var/lib/fernscout/content/example/figures | wc -l'` → 16 after
  a deploy onto a box where the directory was missing.
- `curl -s -o /dev/null -w '%{http_code}' https://fernscout.ch/example` → 200.
