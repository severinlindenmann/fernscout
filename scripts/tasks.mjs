#!/usr/bin/env node
// Move task files between lanes, and regenerate docs/tasks/INDEX.md from what
// is actually on disk.
//
// The lane a file sits in is the task's status — there is no `status:` field,
// because a status kept in two places disagrees with itself within a month.
// This script exists so the index is read off the folders rather than typed,
// for the same reason.
//
// `backlog` is where anything new lands. `open` is the reviewed queue an agent
// may take work from unprompted, and moving a task into it is a person's
// decision — see the skill. The script will not do it for you by accident:
// `new` always writes to backlog/.
//
//   npm run tasks                          what is in each lane
//   npm run tasks -- new --type ISSUE --priority high \
//       --complexity low --title "…" [--area "…"]
//   npm run tasks -- move B01 in-development
//   npm run tasks -- claim B01             say you are on it, without moving it
//   npm run tasks -- release B01           let go of it
//   npm run tasks -- index                 rewrite INDEX.md only
//
// `new`, `move`, `claim` and `release` rewrite INDEX.md as they go — except in
// a linked worktree, where they say so and leave it alone. Add `--index` to
// write it there anyway.
//
// Two things are written into the frontmatter as work happens. **Stamps** are
// whole instants — `found`, `started`, `merged`, `completed` — because several
// agents run here in one afternoon and a date says only "a Tuesday". The
// **hold** is `session` and `claimed`: which agent is on this task now, so a
// parallel session can route around it rather than discovering the collision
// at the merge.
//
// Frontmatter is edited line by line rather than round-tripped through a YAML
// parser: a round trip reformats dates and drops the alignment, and a diff
// full of churn is a diff nobody reads.
//
// Everything here reads the checkout it is run in — except the allocation of a
// new id, which asks every worktree as well. See taskRoots(): a snapshot of
// docs/tasks taken when a branch was created is exactly how two agents end up
// writing the same number.
//
// Two things this script says about the *repository* rather than about a task,
// because it is the one command every session runs and so the only place a
// warning reliably lands in front of somebody. Both come out of the same
// afternoon: several agents sharing one checkout, and nothing announcing when
// that checkout is in a state their next command will make worse.
//
//   - warnDetached()    a checkout on no branch at all, and how many commits
//                       are stranded there. B201.
//   - warnUnfinished()  this checkout is mid-merge, mid-rebase or
//                       mid-cherry-pick, so a lane move committed now lands
//                       inside somebody else's operation. B201.
//
// And one about where INDEX.md may be written: not from a linked worktree, by
// default. See writeIndex().

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(process.cwd(), "docs", "tasks");
// Flow order, which is also the order they are written into INDEX.md.
const LANES = ["backlog", "open", "in-development", "testing", "completed"];
/** Lanes only a person may move a task into. See .claude/skills/manage-tasks. */
const HUMAN_ONLY = new Set(["open", "completed"]);
/** The instant each lane stamps on arrival. */
const STAMPS = { "in-development": "started", testing: "merged", completed: "completed" };
/**
 * Lanes where one agent is on a task and the others should keep off. These are
 * the only lanes that display a holder, and the only ones `claim` will take.
 */
const HELD = new Set(["in-development", "testing"]);
/**
 * The one lane a `move` takes the hold on by itself — starting work *is* the
 * claim, so nobody has to remember a second command.
 *
 * `testing` is deliberately not this, and the reason is easy to miss: the
 * agent that merged is not the one that verifies. `test-the-live-site`
 * dispatches a subagent per ticket, three in flight, and three siblings
 * reading `testing/` need something that tells a ticket already being checked
 * from a free one. So arriving in `testing` *releases* — the builder is done —
 * and whoever verifies it claims.
 */
const CLAIMS_ON_MOVE = "in-development";
/** Where `new` puts things. Never `open` — that lane is a person's review. */
const INTAKE = "backlog";
const TYPES = ["SECURITY", "ISSUE", "FEATURE", "CHORE"];
const PRIORITIES = ["high", "medium", "low"];
const COMPLEXITIES = ["low", "medium", "high"];

const BEGIN = "<!-- generated:begin -->";
const END = "<!-- generated:end -->";

/**
 * A whole instant, to the second, in UTC.
 *
 * Stamps were dates until B145, which in a repository that runs several agents
 * in one afternoon says only "a Tuesday": B01 was found, started and merged on
 * 2026-09-01 and the file cannot say in what order, or how long it sat waiting
 * for somebody. UTC rather than local time because these are written from
 * worktrees, subagents and the VPS, and one canonical spelling sorts.
 *
 * Tasks captured before this keep their date-only stamps. Widening
 * `"2026-09-01"` to a midnight instant would invent a time nobody recorded,
 * and provenance is the entire point.
 */
const now = () => `${new Date().toISOString().slice(0, 19)}Z`;

/** Enough of a session id to recognise, which is all a table has room for. */
const shortSession = (id) => id.slice(0, 8);

/**
 * How long a hold has stood, in words — for the message that refuses to break
 * it, where "4h" is the difference between a live agent and a dead one.
 */
function heldFor(claimed) {
  const since = Date.parse(claimed ?? "");
  if (Number.isNaN(since)) return "unknown";
  const minutes = Math.max(0, Math.round((Date.now() - since) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`;
}

function die(message) {
  console.error(message);
  process.exit(1);
}

/** The frontmatter block and the body, kept as text. */
function split(file) {
  const raw = fs.readFileSync(file, "utf8");
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw);
  if (!match) die(`${path.relative(process.cwd(), file)} has no frontmatter block.`);
  return { front: match[1], body: match[2] };
}

function field(front, key) {
  const match = new RegExp(`^${key}:\\s*(.*)$`, "m").exec(front);
  if (!match) return undefined;
  return match[1].trim().replace(/^["'](.*)["']$/, "$1");
}

/** Remove a key, if it is there. */
function clearField(front, key) {
  return front
    .split("\n")
    .filter((line) => !new RegExp(`^${key}:\\s*`).test(line))
    .join("\n");
}

/**
 * A frontmatter value, quoted only where it has to be. Callers pass the value
 * itself and never its quotes — a timestamp contains `:` and would otherwise
 * be quoted twice, once by the caller and once here.
 */
function yaml(value) {
  return /[:#]/.test(value) ? JSON.stringify(value) : value;
}

/** Set a key, or add it at the end of the block if it is not there yet. */
function setField(front, key, value) {
  const line = `${key}: ${yaml(value)}`;
  const existing = new RegExp(`^${key}:\\s*.*$`, "m");
  return existing.test(front) ? front.replace(existing, line) : `${front}\n${line}`;
}

/**
 * Who is running this. `--session` wins so a wrapper or a subagent can say who
 * it is; otherwise the Claude Code session id, which every agent here has and
 * nobody typing at a shell does.
 *
 * Absent is a real answer, and it means "nobody is holding this". A person
 * moving a task by hand is not a session another agent needs to route around,
 * and pretending otherwise would leave holds nothing ever clears.
 */
function sessionId(argv) {
  const given = flag(argv, "session");
  // `--session` with nothing after it, or with the next flag after it, is a
  // typo — and silently holding the task as "--force" would be worse than
  // saying so.
  if (given !== undefined && (given === "" || given.startsWith("--"))) {
    die("--session needs a session id after it.");
  }
  return given || process.env.CLAUDE_CODE_SESSION_ID || undefined;
}

/** Write the hold: who has it, and since when. No session means let go. */
function takeHold(front, session) {
  if (!session) return releaseHold(front);
  return setField(setField(front, "session", session), "claimed", now());
}

/** Drop the hold entirely. Both fields go, so neither outlives the other. */
function releaseHold(front) {
  return clearField(clearField(front, "session"), "claimed");
}

/**
 * Refuse to take a task somebody else is already on.
 *
 * This is an error and not a warning on purpose. A warning is not a lock — an
 * agent reads one, decides it is probably about somebody else, and carries on,
 * which is exactly the afternoon B143 and B144 came out of. `--force` is the
 * deliberate way past, for the ordinary case where the holder is a session
 * that died; the message says how long the hold has stood so that call can be
 * made on evidence.
 */
function refuseIfHeld(item, session, argv) {
  if (!item.session || item.session === session || argv.includes("--force")) return;
  die(
    `${item.id} is held by session ${shortSession(item.session)}, for ${heldFor(item.claimed)}.\n` +
      `If that session is gone, take it with --force.`,
  );
}

function itemsIn(lane) {
  const dir = path.join(ROOT, lane);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((filename) => {
      const file = path.join(dir, filename);
      const { front } = split(file);
      return {
        lane,
        file,
        filename,
        id: field(front, "id") ?? filename.slice(0, 3),
        title: field(front, "title") ?? filename,
        type: field(front, "type") ?? "ISSUE",
        priority: field(front, "priority") ?? "medium",
        complexity: field(front, "complexity") ?? "medium",
        session: field(front, "session"),
        claimed: field(front, "claimed"),
      };
    })
    .sort(
      (a, b) =>
        PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority) ||
        a.id.localeCompare(b.id),
    );
}

function allItems() {
  return LANES.flatMap(itemsIn);
}

/** A path as the filesystem sees it, so two spellings of one directory dedupe. */
function real(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

/**
 * A read-only question put to git, answered from this checkout.
 *
 * `undefined` rather than a throw, because every way this can fail is an
 * ordinary answer here — no git on PATH, not a repository at all, a ref that
 * does not exist, a temporary directory in a test. None of them is a reason to
 * refuse to move a task file, so every caller treats "I could not find out" as
 * "say nothing".
 *
 * A command that succeeds and prints nothing — `merge-base --is-ancestor`, for
 * one — answers with the empty string, which is why callers compare against
 * `undefined` and not for truthiness.
 */
function git(args) {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

/**
 * Every checkout of this repository as git knows them — the shared one and
 * each linked worktree — with the branch each is on.
 *
 * `branch` absent is the whole point: `git worktree list --porcelain` writes
 * `detached` instead of a `branch` line, and a detached checkout is a checkout
 * whose commits belong to no branch. See warnDetached().
 */
function checkouts() {
  const listed = git(["worktree", "list", "--porcelain"]);
  if (!listed) return [];
  return listed
    .split("\n\n")
    .map((block) => ({
      path: /^worktree (.*)$/m.exec(block)?.[1],
      head: /^HEAD (.*)$/m.exec(block)?.[1],
      branch: /^branch refs\/heads\/(.*)$/m.exec(block)?.[1],
    }))
    .filter((c) => c.path);
}

/**
 * True when this is a linked worktree rather than the shared checkout.
 *
 * In a worktree `--git-dir` is `<repo>/.git/worktrees/<name>` while
 * `--git-common-dir` is `<repo>/.git`; in the shared checkout the two are the
 * same directory. Both can come back relative to the working directory, so
 * they are resolved before they are compared.
 */
function inLinkedWorktree() {
  const own = git(["rev-parse", "--git-dir"]);
  const shared = git(["rev-parse", "--git-common-dir"]);
  if (!own || !shared) return false;
  return real(path.resolve(process.cwd(), own)) !== real(path.resolve(process.cwd(), shared));
}

/**
 * Every `docs/tasks` an id could already be claimed in — this checkout, the
 * main one, and every other worktree.
 *
 * Allocation used to read the current working directory alone, which inside
 * `.claude/worktrees/<branch>` is that worktree's own snapshot of `docs/tasks`,
 * taken when the branch was created. Two sessions branching from the same
 * commit were therefore each told the same number was free, and both wrote it:
 * B99 counts three collisions and a near miss in one afternoon. A task id has
 * to mean one thing forever, because tasks reference each other by it and
 * nothing else.
 *
 * Only allocation looks this wide. Listing, moving and INDEX.md stay local to
 * the checkout they are run in — a worktree's index is that worktree's.
 */
function taskRoots() {
  const roots = new Set([real(ROOT)]);
  const add = (checkout) => {
    const tasks = path.join(checkout, "docs", "tasks");
    if (fs.existsSync(tasks)) roots.add(real(tasks));
  };

  // No git on PATH, or not a repository, leaves this empty. The sweep below
  // still finds whatever is on disk beside us, and a local-only answer is what
  // the script did before this existed.
  const known = checkouts().map((c) => c.path);

  for (const checkout of [process.cwd(), ...known]) {
    add(checkout);
    // A directory under .claude/worktrees/ that git no longer knows about —
    // removed from the registry, or copied there by hand — still holds task
    // files, and an id claimed in one of them is an id somebody is using.
    const nested = path.join(checkout, ".claude", "worktrees");
    if (!fs.existsSync(nested)) continue;
    for (const entry of fs.readdirSync(nested)) add(path.join(nested, entry));
  }
  return [...roots];
}

/**
 * Where an id is written down the instant it is handed out, before the file
 * that will carry it exists.
 *
 * The shared git directory, because `--git-common-dir` is the same path seen
 * from the main checkout and from every worktree, and nothing else is. It has
 * to be somewhere shared: taskRoots() closes the gap between two *branches*,
 * but not the one between two *processes*. Two `new` runs a millisecond apart
 * both scan the same files, both conclude the same number is free, and their
 * captures have different titles and so different filenames — nothing collides
 * on disk and nothing complains. Four agents branched from one commit agree on
 * the answer every time; on 2026-09-03 four of them did.
 *
 * It also covers the quieter version: an id claimed on a branch whose worktree
 * has since been removed is invisible to a scan of the filesystem, but its
 * reservation is still here.
 *
 * Reservations are never cleaned up, and that is deliberate. A stale one only
 * ever pushes the next id higher, and nextId() is already explicit that a gap
 * is harmless where a reused id is not. A fresh clone has none of them, which
 * is also fine — the task files remain the authority and this only ever adds
 * to what they say. B143.
 */
function reservationDir() {
  const shared = git(["rev-parse", "--git-common-dir"]);
  return shared ? path.resolve(process.cwd(), shared, "fernscout-task-ids") : undefined;
}

/**
 * Every id claimed in every checkout, read off the filenames — the whole point
 * is to be cheap enough to run on every `new`, and parsing the frontmatter of
 * a thousand files across five worktrees is not. The local checkout is read
 * properly as well, so its frontmatter stays authoritative for its own ids.
 * Reservations count too: an id handed out one second ago has no file yet.
 */
function claimedIds() {
  const ids = new Set(allItems().map((i) => i.id));
  for (const root of taskRoots()) {
    for (const lane of LANES) {
      const dir = path.join(root, lane);
      if (!fs.existsSync(dir)) continue;
      for (const filename of fs.readdirSync(dir)) {
        const match = /^(B\d+)-.*\.md$/.exec(filename);
        if (match) ids.add(match[1]);
      }
    }
  }
  const reserved = reservationDir();
  if (reserved && fs.existsSync(reserved)) {
    for (const name of fs.readdirSync(reserved)) {
      if (/^B\d+$/.test(name)) ids.add(name);
    }
  }
  return ids;
}

/**
 * One past the highest id anywhere. Deliberately not the lowest free number:
 * an abandoned branch leaves a gap, and a gap is harmless where a reused id is
 * not — `manage-tasks` is explicit that a number means one thing forever.
 */
function nextId() {
  const numbers = [...claimedIds()].map((id) => Number.parseInt(id.replace(/\D/g, ""), 10) || 0);
  return `B${String(Math.max(0, ...numbers) + 1).padStart(2, "0")}`;
}

/**
 * An id, and nobody else can be given it.
 *
 * Ask for the next free number, then claim it with an exclusive create — `wx`
 * fails rather than overwriting, so exactly one of two racing processes wins.
 * The loser asks again, and by then the winner's reservation is in
 * claimedIds(), so the second answer is a different number. This is the step
 * that turns "no two branches" into "no two processes"; see reservationDir().
 *
 * Without a git directory to share — a tarball, a test fixture — this is just
 * nextId(), which is what the script has always done.
 */
function reserveId() {
  const dir = reservationDir();
  if (!dir) return nextId();
  fs.mkdirSync(dir, { recursive: true });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const id = nextId();
    try {
      fs.writeFileSync(path.join(dir, id), `${now()} ${process.cwd()}\n`, { flag: "wx" });
      return id;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
  // Fifty consecutive losses is not contention, it is something wrong — a
  // read-only reservation directory, or a clock that has stopped. Say so
  // rather than handing out a number that was not reserved.
  return die("Could not reserve a task id: fifty numbers in a row were already taken.");
}

/** Ids claimed by more than one file in this checkout, with where they are. */
function duplicateIds() {
  const byId = new Map();
  for (const item of allItems()) {
    const at = byId.get(item.id) ?? [];
    at.push(`${item.lane}/${item.filename}`);
    byId.set(item.id, at);
  }
  return [...byId].filter(([, at]) => at.length > 1);
}

/**
 * Say it out loud. INDEX.md renders both rows without complaint and `move`
 * picks whichever the directory listing yields first, so a collision is
 * invisible until a reference to it silently resolves to the wrong task.
 * Allocation cannot be the only defence: the next one will arrive through a
 * merge, a cherry-pick, or a file copied by hand.
 */
function warnDuplicates() {
  const duplicates = duplicateIds();
  if (duplicates.length === 0) return;
  console.error(`\nWARNING: ${duplicates.length === 1 ? "an id is" : "ids are"} claimed twice.`);
  for (const [id, at] of duplicates) {
    console.error(`  ${id}  ${at.join("   ")}`);
  }
  console.error("Renumber one of each pair — prefer whichever is referenced less. See B99.\n");
}

/**
 * The branch the shared checkout is supposed to be on, if it exists here.
 * `main` in this repository; `master` is only a courtesy to a fork.
 */
function trunk() {
  return ["main", "master"].find(
    (name) => git(["rev-parse", "--verify", "--quiet", `refs/heads/${name}`]) !== undefined,
  );
}

/**
 * Say when a checkout of this repository is on no branch at all.
 *
 * Found on 2026-09-03: the shared checkout was on a detached HEAD with
 * eighteen commits on it — six merges and a dozen lane moves, from four
 * sessions — while `refs/heads/main` still pointed eleven hours back. Nothing
 * announced it, because nothing has to: `git commit`, `git merge` and this
 * script all keep working while detached. The commits are real and reachable
 * from HEAD. They are simply on no branch, and the next `git checkout main`
 * anybody runs there silently rewinds past all of them, leaving the reflog —
 * which is per-checkout, expires, and is the last place anybody looks.
 *
 * So it is said here, from every checkout, about every checkout: an agent
 * standing in its own worktree is exactly who should learn that the shared one
 * has come off its branch, because it is about to merge into it.
 *
 * The recovery is printed only when it is safe — when trunk is an ancestor of
 * the stranded HEAD, so `git branch -f` is a fast-forward and loses nothing.
 * When the two have diverged, this stops at naming it. Re-pointing a branch
 * that has commits of its own is a person's call, and a script that guesses
 * wrong there destroys more than the problem it was fixing. B201.
 */
function warnDetached() {
  const detached = checkouts().filter((c) => !c.branch);
  if (detached.length === 0) return;
  const base = trunk();

  console.error("");
  for (const { path: where, head } of detached) {
    const at = head ?? "HEAD";
    const stranded = base === undefined ? undefined : Number(git(["rev-list", "--count", `${base}..${at}`]));
    const count = Number.isFinite(stranded) ? stranded : undefined;
    console.error(
      `WARNING: ${where} is on a detached HEAD` +
        (count === undefined
          ? "."
          : `; ${count} commit${count === 1 ? "" : "s"} ${count === 1 ? "is" : "are"} on no branch.`),
    );
    if (base === undefined) continue;
    // Empty string is the success of a command that prints nothing; undefined
    // is the non-zero exit that means "not an ancestor".
    const fastForward = git(["merge-base", "--is-ancestor", base, at]) !== undefined;
    console.error(
      fastForward
        ? `  Recover there:  git branch -f ${base} ${at.slice(0, 7)} && git checkout ${base}`
        : `  ${base} has diverged from it. Do not check out a branch there — a person decides this one.`,
    );
  }
  console.error("");
}

/**
 * Say when this checkout is halfway through a merge, rebase, cherry-pick or
 * revert.
 *
 * Lane moves are committed straight to the shared checkout without a branch,
 * which is the one exception `AGENTS.md` makes and is right. It also means a
 * `move` run during somebody else's half-finished merge writes a task file
 * into that operation's index, and it comes out inside their merge commit —
 * or, worse, is staged next to conflict markers nobody has resolved yet. The
 * same afternoon produced the other half of this: another session's
 * uncommitted task files stopped a `git merge` before it started, twice.
 *
 * Only this checkout, not every one. A sibling worktree mid-rebase is its
 * session's business and not something to shout about here. B201.
 */
function warnUnfinished() {
  const operations = [
    ["MERGE_HEAD", "a merge"],
    ["rebase-merge", "a rebase"],
    ["rebase-apply", "a rebase"],
    ["CHERRY_PICK_HEAD", "a cherry-pick"],
    ["REVERT_HEAD", "a revert"],
  ];
  for (const [marker, what] of operations) {
    const at = git(["rev-parse", "--git-path", marker]);
    if (!at || !fs.existsSync(path.resolve(process.cwd(), at))) continue;
    console.error(
      `\nWARNING: this checkout is in the middle of ${what}.\n` +
        "  Finish or abort it before moving tasks — a lane move committed now lands inside it.\n",
    );
    return;
  }
}

function slug(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .split("-")
    .slice(0, 6)
    .join("-");
}

function table(lane) {
  const items = itemsIn(lane);
  if (items.length === 0) return "_Nothing here._\n";
  // Only the lanes where somebody can be on a task carry a holder column. Sixty
  // backlog rows of an empty column is noise, and noise in a generated table is
  // what stops people reading generated tables.
  const held = HELD.has(lane);
  const rows = items.map(
    (i) =>
      `| [${i.id}](${lane}/${i.filename}) | ${i.title} | ${i.type} | ${i.priority} | ${i.complexity} |` +
      (held ? ` ${i.session ? `\`${shortSession(i.session)}\`` : "—"} |` : ""),
  );
  return [
    `| # | Finding | Type | Priority | Complexity |${held ? " Held by |" : ""}`,
    `| --- | --- | --- | --- | --- |${held ? " --- |" : ""}`,
    ...rows,
    "",
  ].join("\n");
}

/**
 * Rewrite the generated block of INDEX.md from the lanes on disk.
 *
 * **Not from a linked worktree, unless asked.** A worktree's `docs/tasks` is
 * the snapshot taken when its branch was cut, so the table regenerated there
 * describes a lane layout that has since moved on: tasks that merged, holds
 * that were dropped, rows for files now in another folder. Committing that
 * block and merging it does two things, and the second is the expensive one —
 * it reinstates stale rows, and it conflicts, because every other branch in
 * flight regenerated the same block from its own snapshot. Eleven branches
 * merged on 2026-09-04 and INDEX.md conflicted on every one of them; nothing
 * else did.
 *
 * The index is a rendering of the folders and is worth exactly one command to
 * rebuild, so the honest place to rebuild it is the checkout that has the
 * folders: `npm run tasks -- index` on main, after the merge. `--index` forces
 * it here for the rare case somebody wants the worktree's own view, and the
 * `index` command is always explicit enough to mean it.
 *
 * This is also what makes `npm run tasks -- new` safe to run from a worktree,
 * which is the whole point: capture needs an id from nextId(), and the only
 * reason agents were hand-writing files instead was that `new` rewrote this
 * table. B143, and the merge evidence in B201.
 */
function writeIndex({ force = false } = {}) {
  if (!force && inLinkedWorktree()) {
    console.log(
      "docs/tasks/INDEX.md not rewritten — this is a linked worktree, and its lanes are a\n" +
        "snapshot. Run `npm run tasks -- index` in the main checkout after merging, or pass\n" +
        "--index to write it here anyway.",
    );
    return;
  }
  const file = path.join(ROOT, "INDEX.md");
  const raw = fs.readFileSync(file, "utf8");
  const start = raw.indexOf(BEGIN);
  const end = raw.indexOf(END);
  if (start === -1 || end === -1) {
    die(`docs/tasks/INDEX.md is missing its ${BEGIN} / ${END} markers.`);
  }
  const generated = [
    BEGIN,
    "",
    ...LANES.flatMap((lane) => [`## ${lane}`, "", table(lane)]),
  ].join("\n");
  fs.writeFileSync(file, raw.slice(0, start) + generated + raw.slice(end));
  console.log(`docs/tasks/INDEX.md — ${allItems().length} tasks across ${LANES.length} lanes.`);
}

function flag(argv, name) {
  const at = argv.indexOf(`--${name}`);
  return at === -1 ? undefined : argv[at + 1];
}

function create(argv) {
  const title = flag(argv, "title");
  const type = (flag(argv, "type") ?? "").toUpperCase();
  const priority = flag(argv, "priority") ?? "medium";
  const complexity = flag(argv, "complexity") ?? "medium";
  const area = flag(argv, "area") ?? "";

  if (!title) die("--title is required.");
  if (!TYPES.includes(type)) die(`--type must be one of ${TYPES.join(", ")}.`);
  if (!PRIORITIES.includes(priority)) die(`--priority must be one of ${PRIORITIES.join(", ")}.`);
  if (!COMPLEXITIES.includes(complexity)) {
    die(`--complexity must be one of ${COMPLEXITIES.join(", ")}.`);
  }

  const id = reserveId();
  const file = path.join(ROOT, INTAKE, `${id}-${slug(title)}.md`);
  // reserveId() asked every checkout and then claimed the number, so this
  // cannot normally happen. Overwriting somebody else's capture is still the
  // one outcome worth refusing outright.
  if (fs.existsSync(file)) die(`${path.relative(process.cwd(), file)} already exists.`);
  const front = [
    `id: ${id}`,
    `title: ${title}`,
    `type: ${type}`,
    `priority: ${priority}`,
    `complexity: ${complexity}`,
    ...(area ? [`area: ${area}`] : []),
    `found: ${yaml(now())}`,
  ].join("\n");

  fs.writeFileSync(
    file,
    `---\n${front}\n---\n\n# ${id} — ${title}\n\n## Why\n\nTODO — the problem, not the fix.\n\n## Work\n\nTODO\n\n## Acceptance\n\nTODO\n`,
  );
  console.log(`Created ${path.relative(process.cwd(), file)}`);
  writeIndex({ force: argv.includes("--index") });
}

function move(argv) {
  const [id, lane] = argv;
  if (!id || !LANES.includes(lane)) {
    die(`Usage: move <id> <${LANES.join("|")}> [--session <id>] [--force]`);
  }
  const item = allItems().find((i) => i.id.toLowerCase() === id.toLowerCase());
  if (!item) die(`No item with id ${id}.`);
  if (item.lane === lane) die(`${item.id} is already in ${lane}.`);

  const session = sessionId(argv);
  // Only taking it can collide. Every other move lets go, and letting go of
  // somebody else's hold is what a person does when a session has died.
  if (lane === CLAIMS_ON_MOVE) refuseIfHeld(item, session, argv);

  const { front, body } = split(item.file);
  let updated = front;

  // A task that goes backwards — testing back to in-development because it did
  // not hold up, anything back to backlog — loses the stamps for the lanes it
  // no longer occupies. Otherwise a task in backlog/ carries a `merged:` date
  // for a merge that is no longer true of it.
  if (LANES.indexOf(lane) < LANES.indexOf(item.lane)) {
    for (const [at, key] of Object.entries(STAMPS)) {
      if (LANES.indexOf(at) > LANES.indexOf(lane)) updated = clearField(updated, key);
    }
  }
  if (STAMPS[lane]) updated = setField(updated, STAMPS[lane], now());

  // Starting work is the claim. Arriving anywhere else lets go — including
  // `testing`, where the next agent to touch the task is not this one.
  updated = lane === CLAIMS_ON_MOVE ? takeHold(updated, session) : releaseHold(updated);

  // The lane directory may not exist yet — an empty lane keeps only a
  // .gitkeep, and a newly added lane keeps nothing at all. Renaming into a
  // missing directory throws *after* the stamp has been written, which leaves
  // the task in its old lane wearing a date for a move that did not happen.
  const target = path.join(ROOT, lane, item.filename);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(item.file, `---\n${updated}\n---\n${body}`);
  fs.renameSync(item.file, target);
  console.log(`${item.id}: ${item.lane} → ${lane}`);
  if (lane === CLAIMS_ON_MOVE) {
    console.log(
      session
        ? `  held by session ${shortSession(session)}.`
        : `  note: no session to hold it with — another agent has no way to see it is taken.`,
    );
  }
  const skipped = LANES.indexOf(lane) - LANES.indexOf(item.lane);
  if (skipped > 1) {
    console.log(
      `  note: skipped ${LANES.slice(LANES.indexOf(item.lane) + 1, LANES.indexOf(lane)).join(", ")}.`,
    );
  }
  if (HUMAN_ONLY.has(lane)) {
    console.log(
      `  note: ${lane}/ is a human gate — an agent moves a task here only when asked to, in that turn.`,
    );
  }
  writeIndex({ force: argv.includes("--index") });
}

/**
 * Take a task, or let it go, **without moving it between lanes**.
 *
 * `move` covers the ordinary case, where starting work and claiming it are the
 * same act. This is for the one that does not fit: a ticket in `testing/` has
 * to stay in `testing/` while somebody verifies it — only a person moves it out
 * — so there is no lane change to hang the claim on. Without this, three
 * sibling verification agents have nothing to divide the lane between them.
 */
function hold(argv, take) {
  const [id] = argv;
  if (!id) die(`Usage: ${take ? "claim <id> [--session <id>] [--force]" : "release <id>"}`);
  const item = allItems().find((i) => i.id.toLowerCase() === id.toLowerCase());
  if (!item) die(`No item with id ${id}.`);

  const session = take ? sessionId(argv) : undefined;
  if (take) {
    if (!session) {
      die("Nothing to claim with. Pass --session <id>, or run where CLAUDE_CODE_SESSION_ID is set.");
    }
    if (!HELD.has(item.lane)) {
      die(
        `${item.id} is in ${item.lane}/, where nobody holds anything. ` +
          `Claims live in ${[...HELD].map((l) => `${l}/`).join(" and ")}.`,
      );
    }
    refuseIfHeld(item, session, argv);
  }

  const { front, body } = split(item.file);
  const updated = take ? takeHold(front, session) : releaseHold(front);
  fs.writeFileSync(item.file, `---\n${updated}\n---\n${body}`);
  console.log(
    take
      ? `${item.id}: held by session ${shortSession(session)} in ${item.lane}/.`
      : `${item.id}: released${item.session ? ` by session ${shortSession(item.session)}` : ""}.`,
  );
  writeIndex({ force: argv.includes("--index") });
}

function list() {
  for (const lane of LANES) {
    const items = itemsIn(lane);
    console.log(`\n${lane} (${items.length})`);
    for (const i of items) {
      const holder = i.session ? `  ← ${shortSession(i.session)}, ${heldFor(i.claimed)}` : "";
      console.log(`  ${i.id}  ${i.type.padEnd(8)} ${i.priority.padEnd(6)} ${i.title}${holder}`);
    }
  }
  console.log("");
}

const [command, ...rest] = process.argv.slice(2);
if (!fs.existsSync(ROOT)) die("Run this from the repository root — docs/tasks is not here.");

switch (command) {
  case undefined:
  case "list":
    list();
    break;
  case "new":
    create(rest);
    break;
  case "move":
    move(rest);
    break;
  case "claim":
    hold(rest, true);
    break;
  case "release":
    hold(rest, false);
    break;
  case "index":
    // Asked for by name, so it is meant — write it wherever it was run.
    writeIndex({ force: true });
    break;
  default:
    die(`Unknown command "${command}". Try: list, new, move, claim, release, index.`);
}

// Said once, after whatever was asked for, and on stderr so it survives being
// piped. Every one of these is about the repository rather than about a task,
// and this is the only command every session runs.
warnDuplicates();
warnDetached();
warnUnfinished();
