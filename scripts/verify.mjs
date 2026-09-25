#!/usr/bin/env node
// The five checks every change passes, in the one order that works.
//
//   npm run verify              build → tsc → eslint → vitest → knip
//   npm run verify -- --quick   reuse a proven-current build, or rebuild
//
// Why a script rather than five commands in a document: the order is not
// cosmetic and it was getting typed by hand a hundred and forty times a week.
// `next build` writes the typed-route definitions into `.next/types`, and
// `PageProps`, `LayoutProps` and `RouteContext` resolve against them. Run
// `tsc` on a checkout where no build has happened since a route appeared — a
// fresh worktree, or `main` right after a merge that added routes — and it
// reports dozens of errors in files nobody opened. The honest readings
// available to whoever sees that are "the merge is broken" or "the
// documentation is wrong", and neither is true: the types have not been
// generated yet. `.github/workflows/ci.yml` builds before it typechecks for
// exactly this reason. B100.
//
// **It stops at the first failure**, which is the other half of the point. A
// run that carries on after the build broke spends two more minutes proving
// that a tree which does not compile also does not pass its tests.
//
// `--quick` skips the build only when a stamp from the last successful build
// proves both its route inputs and generated output are unchanged. Editing the
// body of an ordinary component does not invalidate `.next/types`; adding
// `app/foo/page.tsx` does, so quick mode rebuilds before typechecking.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { inspectRouteTypesStamp } from "./route-types-stamp.mjs";
import { assertRepositoryNode } from "./runtime-preflight.mjs";
import { acquireSlot } from "./slot.mjs";

const quick = process.argv.includes("--quick");


/**
 * Six agents in one day read the instruction to pass `timeout: 900000`,
 * reasoned — correctly, at every step — that a five-minute run exceeds their
 * tool's two-minute default, and ran it in the background instead. Then each
 * one ended its turn to "wait for the result". Nothing wakes a finished turn:
 * the run completes into a file nobody reads, and the work sits
 * finished-but-unreported until a person prods the session. Rewording the
 * instruction cannot fix this — the next agent read the same sentence and did
 * it anyway — so this is a guard instead.
 *
 * There is no way to ask the OS "was I backgrounded and abandoned": a process
 * run in the foreground with a long timeout and a process backgrounded and
 * never awaited are indistinguishable from inside — same pipes, same
 * `isTTY`, same everything. What *is* visible is whether anyone is watching
 * a real terminal at all. A human typing `npm run verify` at a prompt has
 * `stdout.isTTY`; every other caller — including an agent's tool call, run
 * either foreground or backgrounded — does not. So an unattended caller has
 * to say, once and on purpose, that it is going to wait: set `VERIFY_WILL_WAIT=1`
 * alongside a real timeout, in the same call. There is no way to trip that by
 * reasoning about a two-minute default; it takes typing the name.
 *
 * `CI` is honoured too, in case this script is ever wired into a pipeline —
 * it currently is not: `.github/workflows/ci.yml` runs build, tsc, eslint,
 * vitest and knip as five separate steps rather than through this file, so
 * nothing here can block a CI run today. If that changes, this refusal must
 * not be what breaks it.
 */
if (!process.stdout.isTTY && !process.env.CI && !process.env.VERIFY_WILL_WAIT) {
  console.error(
    "Refused: no terminal is attached and nothing said it will wait.\n" +
      "\n" +
      "This is not a broken tree — it is a guard against the way this run gets\n" +
      "lost. `npm run verify` takes about five minutes; a tool call whose default\n" +
      "timeout is shorter than that will time out mid-suite unless you raise it.\n" +
      "The fix is a longer timeout, not the background: pass `timeout: 900000`\n" +
      "and run this in the foreground, waiting for it to finish in the same turn.\n" +
      "\n" +
      "Backgrounding this and ending your turn to 'wait for the result' means\n" +
      "nothing can wake you — the run finishes into a file nobody reads, and the\n" +
      "work sits done-but-unreported until a person notices. Six agents did this\n" +
      "in a single day with the timeout instruction already in their brief.\n" +
      "\n" +
      "To run this unattended anyway, set VERIFY_WILL_WAIT=1 in the same call\n" +
      "that sets the long timeout — it is not read for any other reason, and\n" +
      "setting it is the only way past this message.\n",
  );
  process.exit(1);
}

/**
 * The node-version preflight runs *after* the guard above, not before it.
 * It reads `.nvmrc`, and a caller that is about to be refused for being
 * detached should be told that — not handed an ENOENT stack from a file it
 * was never going to need. Deciding whether to start comes before checking
 * what would have run.
 */
assertRepositoryNode(process.cwd());

/**
 * A worktree has no `node_modules` of its own. `npx tsc`, `eslint` and
 * `vitest` resolve upward to the main checkout's copy and appear to work;
 * `next build` does not, and fails in a way that reads like a broken tree
 * rather than a missing install. Said here, before two minutes are spent
 * finding out.
 */
if (!fs.existsSync(path.join(process.cwd(), "node_modules", "next"))) {
  console.error(
    "No node_modules here — run `npm ci` first.\n" +
      "A linked worktree starts without one, and the checks that resolve upward to\n" +
      "the main checkout's copy will lie to you before `next build` refuses.",
  );
  process.exit(1);
}

let skipBuild = false;
if (quick) {
  const routeTypes = inspectRouteTypesStamp(process.cwd(), process.env.NEXT_DIST_DIR || ".next");
  skipBuild = routeTypes.valid;
  console.log(
    routeTypes.valid
      ? `--quick: build reuse is safe because ${routeTypes.reason}.`
      : `--quick: running the build because ${routeTypes.reason}.`,
  );
}

const steps = [
  ["build", ["npm", ["run", "build"]], "the build, which also writes .next/types"],
  ["types", ["npx", ["tsc", "--noEmit"]], "the typecheck"],
  ["lint", ["npx", ["eslint", "."]], "the linter"],
  ["tests", ["npx", ["vitest", "run"]], "the suite"],
  // CI runs this as its own "unused" job, separate from build/typecheck/lint/
  // test, so it used to pass here and fail only there — an export left
  // unreferenced by an ordinary edit (not a whole file or dependency removed)
  // is the shape that kept slipping through. Running it every time, last, is
  // cheap: knip does not touch the network and takes under two seconds.
  ["unused", ["npm", ["run", "unused"]], "knip"],
].filter(([name]) => !(skipBuild && name === "build"));

/**
 * Runs a step, echoing its output live (as `stdio: "inherit"` did) while also
 * keeping a copy of every line. On failure, `--- FAIL` output — the part that
 * actually names a broken test — has usually scrolled past a long run by the
 * time it stops; this is what lets us print it again, once, right where it is
 * read. B713: `npm run verify` used to end in only a count and this banner,
 * which turned a one-minute diagnosis into three full suite re-runs.
 */
function runCapturing(command, args) {
  return new Promise((resolve) => {
    const lines = [];
    let carry = "";
    const onChunk = (stream) => (chunk) => {
      stream.write(chunk);
      carry += chunk.toString("utf8");
      const parts = carry.split("\n");
      carry = parts.pop();
      lines.push(...parts);
    };
    const child = spawn(command, args, {
      stdio: ["inherit", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
    child.stdout.on("data", onChunk(process.stdout));
    child.stderr.on("data", onChunk(process.stderr));
    child.on("close", (status) => {
      if (carry) lines.push(carry);
      resolve({ status, lines });
    });
  });
}

// One heavy slot for the whole run — the build, tsc, ESLint and Vitest all
// inherit it. Several sessions verifying at once is what exhausted the
// machine; the third one now waits here instead (B2144).
await acquireSlot("heavy", `verify ${path.basename(process.cwd())}`);

const started = Date.now();
for (const [name, [command, args], what] of steps) {
  console.log(`\n─── ${name}: ${command} ${args.join(" ")}\n`);
  const { status, lines } = await runCapturing(command, args);
  if (status !== 0) {
    if (name === "tests") {
      const failing = lines.filter((l) => /(FAIL|✗|✕)/.test(l));
      console.error(
        failing.length
          ? `\n─── failing tests, reprinted so they don't have to be scrolled back to:\n\n${failing.join("\n")}\n`
          : "\n─── vitest failed but printed nothing matching FAIL/✗/✕ — read the output above.\n",
      );
    }
    if (name === "build" && lines.some((l) => l.includes("Another next build process is already running"))) {
      console.error(
        "\n─── build failed, but not because of this tree: another `next build`\n" +
          "    is running in this same checkout right now (a second session, most\n" +
          "    likely). That process holds the lock; nothing here is broken. Wait\n" +
          "    for it to finish and run `npm run verify` again — do not read this as\n" +
          "    your change failing.\n",
      );
      process.exit(status ?? 1);
    }
    console.error(
      `\n─── ${name} failed. Stopping here — ${what} is what to read, and the steps` +
        `\n    after it would only tell you again that this tree is not ready.\n`,
    );
    process.exit(status ?? 1);
  }
}

console.log(
  `\n─── all ${steps.length} passed in ${Math.round((Date.now() - started) / 1000)}s.` +
    (skipBuild ? "  (build safely reused — --quick)\n" : "\n"),
);
