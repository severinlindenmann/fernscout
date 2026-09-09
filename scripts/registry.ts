/**
 * B1064's registry, from the shell.
 *
 *   npm run registry -- reconcile
 *
 * Rebuilds `content/.registry/` from `content/`, which is the truth. Run
 * this after a restore, after hand-editing a `config.json`'s `owner.email` or
 * `owner.tel`, or any time the lock and the disk might have drifted — the
 * directory is disposable by design; see `lib/registry.ts`.
 */
import { reconcile } from "../lib/registry.ts";

const [command] = process.argv.slice(2);
if (command !== "reconcile") {
  console.error("Usage:\n  npm run registry -- reconcile");
  process.exit(1);
}

const result = reconcile();
console.log(
  `Reconciled ${result.journals} journals: ${result.emails} email(s), ${result.tels} number(s).`,
);
for (const problem of result.problems) console.warn(`  ! ${problem}`);
if (result.problems.length > 0) process.exit(1);
