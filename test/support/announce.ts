/**
 * Say, on stderr, that something is being skipped and what would un-skip it.
 *
 * Why not `console.warn`: Vitest 4 defaults `silent` to `"passed-only"`, so
 * every `console.*` call from a file whose tests all pass is collected and
 * then thrown away. The two skips this repository already had — restic in
 * `backup-script.test.ts`, `POSTGRES_TEST_URL` in the db suites — were written
 * as `console.warn` and have therefore been printing to nobody. A skip nobody
 * can see is indistinguishable from a pass, which is the whole thing B181 is
 * about. `process.stderr.write` is not intercepted, so it survives.
 *
 * Keep the messages actionable: name the command, not the missing variable.
 */
export function announceSkip(lines: string): void {
  process.stderr.write(`${lines}\n`);
}
