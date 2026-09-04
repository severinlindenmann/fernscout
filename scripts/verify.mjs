#!/usr/bin/env node
// The four checks every change passes, in the one order that works.
//
//   npm run verify              build → tsc → eslint → vitest
//   npm run verify -- --quick   the same, without the build
//
// Why a script rather than four commands in a document: the order is not
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
// `--quick` skips the build, and is honest in one situation: you have already
// built in this checkout and have not added, moved or deleted a route since.
// Editing the body of a component does not invalidate `.next/types`; adding
// `app/foo/page.tsx` does. When in doubt, leave it off — a build is seventy
// seconds and a wrong answer from `tsc` costs longer than that to understand.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const quick = process.argv.includes("--quick");

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

const steps = [
  ["build", ["npm", ["run", "build"]], "the build, which also writes .next/types"],
  ["types", ["npx", ["tsc", "--noEmit"]], "the typecheck"],
  ["lint", ["npx", ["eslint", "."]], "the linter"],
  ["tests", ["npx", ["vitest", "run"]], "the suite"],
].filter(([name]) => !(quick && name === "build"));

if (quick && !fs.existsSync(path.join(process.cwd(), ".next", "types"))) {
  console.error(
    "--quick, but .next/types does not exist: nothing has been built in this\n" +
      "checkout, so the typecheck has no route definitions to resolve against and\n" +
      "will report errors in files you never opened. Run without --quick.",
  );
  process.exit(1);
}

const started = Date.now();
for (const [name, [command, args], what] of steps) {
  console.log(`\n─── ${name}: ${command} ${args.join(" ")}\n`);
  const { status } = spawnSync(command, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (status !== 0) {
    console.error(
      `\n─── ${name} failed. Stopping here — ${what} is what to read, and the steps` +
        `\n    after it would only tell you again that this tree is not ready.\n`,
    );
    process.exit(status ?? 1);
  }
}

console.log(
  `\n─── all ${steps.length} passed in ${Math.round((Date.now() - started) / 1000)}s.` +
    (quick ? "  (build skipped — --quick)\n" : "\n"),
);
