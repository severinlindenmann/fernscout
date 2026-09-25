#!/usr/bin/env node
// Machine-wide slots, so concurrent sessions queue for the machine instead of
// fighting over it. B2144.
//
//   node scripts/slot.mjs status                 who holds what, right now
//   node scripts/slot.mjs dev -- next dev ...    run a command holding a slot
//
// Several agent sessions on one Mac each ran `npm run verify` — a Next build,
// a full tsc, ESLint, Vitest — plus a dev server and a browser per worktree.
// Nothing limited how many ran at once, and four together took the whole
// machine down. A slot is a file under ~/.fernscout/slots (every checkout and
// worktree sees the same folder); creating it with `wx` is atomic, so two
// sessions can never both take one.
//
//   heavy  FERNSCOUT_HEAVY_SLOTS (2)  waits in line, and while available memory
//                                     is under FERNSCOUT_MIN_FREE_GB (4)
//   dev    FERNSCOUT_DEV_SLOTS (3)    refuses instead: a dev server never
//                                     finishes, so waiting for one is forever
//
// A slot whose pid is dead is freed by whoever finds it. A slot whose pid is
// alive is never touched — no session stops another session's work.

import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const KINDS = {
  heavy: { env: "FERNSCOUT_HEAVY_SLOTS", fallback: 2, wait: true },
  dev: { env: "FERNSCOUT_DEV_SLOTS", fallback: 3, wait: false },
};

const slotDir = () => process.env.FERNSCOUT_SLOT_DIR || path.join(os.homedir(), ".fernscout", "slots");
const number = (name, fallback) => (process.env[name] ? Number(process.env[name]) : fallback);
const slotCount = (kind) => number(KINDS[kind].env, KINDS[kind].fallback);
const minFreeBytes = () => number("FERNSCOUT_MIN_FREE_GB", 4) * 2 ** 30;

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

// ponytail: a recycled pid keeps a dead holder's slot until that pid exits too,
// and two readers freeing the same dead slot at once can drop a fresh claim;
// both are rare enough that a lock around the reap is not worth it yet.
function readHolders(kind) {
  const holders = [];
  for (let n = 1; n <= slotCount(kind); n++) {
    const file = path.join(slotDir(), `${kind}-${n}`);
    let holder;
    try {
      holder = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    if (alive(holder.pid)) holders.push(holder);
    else fs.rmSync(file, { force: true });
  }
  return holders;
}

/** Free memory as Activity Monitor counts it: free + inactive + speculative pages. */
function availableBytes() {
  if (process.platform !== "darwin") return os.freemem();
  try {
    const out = execFileSync("vm_stat", { encoding: "utf8" });
    const page = Number(out.match(/page size of (\d+)/)?.[1] ?? 16384);
    const pages = (name) => Number(out.match(new RegExp(`Pages ${name}:\\s+(\\d+)`))?.[1] ?? 0);
    return (pages("free") + pages("inactive") + pages("speculative")) * page;
  } catch {
    return os.freemem();
  }
}

function tryTake(kind, label) {
  readHolders(kind); // frees dead holders' files first
  const record = JSON.stringify({ pid: process.pid, label, cwd: process.cwd(), since: new Date().toISOString() });
  for (let n = 1; n <= slotCount(kind); n++) {
    const file = path.join(slotDir(), `${kind}-${n}`);
    try {
      fs.writeFileSync(file, record, { flag: "wx" });
      return file;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
  return null;
}

const describe = (h) =>
  `${h.label} (pid ${h.pid}, ${Math.round((Date.now() - Date.parse(h.since)) / 1000)}s, ${h.cwd})`;

/**
 * Takes a slot of `kind` for this process and everything it spawns. Resolves
 * once held; a nested call in a child (verify → npm run build) reuses the
 * parent's slot rather than taking a second one. `dev` exits when full.
 */
export async function acquireSlot(kind, label) {
  if (process.env.FERNSCOUT_SLOTS === "off" || process.env.FERNSCOUT_SLOT_HELD === kind) return;
  fs.mkdirSync(slotDir(), { recursive: true });

  let told = "";
  for (;;) {
    const lowMemory = kind === "heavy" && availableBytes() < minFreeBytes();
    const file = lowMemory ? null : tryTake(kind, label);
    if (file) {
      process.env.FERNSCOUT_SLOT_HELD = kind;
      const release = () => {
        try {
          if (JSON.parse(fs.readFileSync(file, "utf8")).pid === process.pid) fs.rmSync(file, { force: true });
        } catch {}
      };
      // A signal or a crash skips "exit"; the next reader frees a dead pid's slot.
      process.on("exit", release);
      if (kind === "heavy") {
        // Children inherit the niceness, so an interactive app stays responsive.
        try {
          os.setPriority(10);
        } catch {}
      }
      if (told) console.error(`─── ${kind} slot free — starting ${label}.`);
      return;
    }

    const holders = readHolders(kind);
    const why = lowMemory
      ? `only ${(availableBytes() / 2 ** 30).toFixed(1)} GB memory available (need ${minFreeBytes() / 2 ** 30} GB)`
      : `all ${slotCount(kind)} ${kind} slots are taken`;
    const message = `─── ${why}:\n${holders.map((h) => `      ${describe(h)}`).join("\n") || "      (none)"}\n`;

    if (!KINDS[kind].wait) {
      console.error(
        `${message}\n    A dev server never finishes, so this does not wait. Stop one of yours\n` +
          `    (kill its pid, or \`lsof -ti :PORT | xargs kill\`) — never another session's —\n` +
          `    or raise ${KINDS[kind].env}.\n`,
      );
      process.exit(1);
    }
    const key = `${lowMemory} ${holders.map((h) => h.pid).join(",")}`;
    if (key !== told) {
      console.error(`${message}    Waiting for a slot — this is the queue, not a failure.\n`);
      told = key;
    }
    // ponytail: polling with jitter, not a FIFO queue; add tickets if someone starves.
    await new Promise((r) => setTimeout(r, 2000 + Math.random() * 1000));
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [kind, dashes, command, ...args] = process.argv.slice(2);
  if (kind === "status") {
    for (const k of Object.keys(KINDS)) {
      const holders = readHolders(k);
      console.log(`${k}: ${holders.length}/${slotCount(k)}`);
      for (const h of holders) console.log(`  ${describe(h)}`);
    }
  } else if (KINDS[kind] && dashes === "--" && command) {
    await acquireSlot(kind, [command, ...args].join(" "));
    const bin = path.join(process.cwd(), "node_modules", ".bin", command);
    const child = spawn(fs.existsSync(bin) ? bin : command, args, { stdio: "inherit" });
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => child.kill(signal));
    child.on("close", (status) => process.exit(status ?? 1));
  } else {
    console.error("usage: node scripts/slot.mjs status | <heavy|dev> -- <command> [args]");
    process.exit(2);
  }
}
