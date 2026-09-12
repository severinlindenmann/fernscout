# v2 migration — the clean cut (supersedes the eight-wave draft below the fold)

Full plan: https://claude.ai/code/artifact/c3bee44b-5e2e-476f-af43-8f5a7409bae9

Context that changed the plan: this is a TEST instance — two journals
(example + the owner's), no third-party agents, full permission to
recreate. So: no parallel operation, no aliases, no Deprecation/Sunset
phase, no parity suite, no dual-read shims. Instead:

- **Build v2 complete on one branch, deleting v1 area by area as each
  lands.** The branch deploys only when whole.
- **Migration = replay through the front door**: a script reads each old
  journal with v1 readers and re-creates it by calling v2's real HTTP
  API. No file copying → no legacy key survives; the content tree becomes
  canonical v2. The replay is also the hardest end-to-end test.
- **Blue/green**: v2 deploys as a second instance (own dir/DB/port);
  blue (v1) stays frozen and serving until sign-off; DNS swap is minutes
  and reversible; blue lives through a two-week overlap, then dies.
- **Trust = instruments, not agent claims** (the build is agent-run):
  1. inventory diff — a ~100-line auditable no-model script dumps
     trips/days/media (incl. content hashes of originals) from both
     instances; machine diff must show only documented drops;
  2. migration report — every dropped/mapped field listed; an unlisted
     transformation fails the gate;
  3. render diff — crawl both sites (anon + owner), text diff + paired
     screenshots;
  4. builder ≠ verifier — fresh agents get only openapi.json + a URL and
     drive every flow blind; persona rounds on /agent;
  5. the owner reads their own journal on green — the final gate.

Phases: 0 freeze spec (V/T folded; V4 unknown-key-preservation dropped —
replaced by canonicalise+report; V3 advisory machinery kept but not
launch-blocking) → 1 build complete + delete v1 + build the migrator and
diff scripts (different agent than the routes) → 2 green up, replay both
journals, assemble the sign-off package → 3 swap, two-week overlap, then
blue and the migrator itself are deleted and AGENTS.md is rewritten.

Owner decisions M1–M4 (DB tables to keep, replay re-publishes?, the
standard migration decline sentence, overlap length) are in the artifact.
