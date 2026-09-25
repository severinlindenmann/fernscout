/**
 * Reads `test/studio/conformance.manifest.ts` and says how much of the
 * studio's §9 checklist is actually proven.
 *
 *   npm run studio:check
 *   npm run studio:check -- --manifest test/studio/fixtures/some.manifest.ts
 *
 * B1838. The manifest is the list of things that must be true, written once,
 * before any of them are — see the doc comment at the top of the manifest
 * file for why a list beats a test suite here. This script is the "reader"
 * half: it does not decide what counts as proof, it enforces the three
 * shapes the manifest is allowed to claim and refuses everything else.
 *
 * Exit code is non-zero while any item is outstanding — including every item
 * whose `proof` is `null`, which is the entire manifest on the day this
 * ticket ships. That is correct: this script is meant to fail for the whole
 * length of the studio run, on purpose, and `npm run verify` never calls it
 * (see AGENTS.md and the ticket — the gate's own redness must not be what
 * `verify` reports).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import type { ManifestItem, Proof } from "../test/studio/conformance.manifest.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");

export interface ItemResult {
  id: string;
  proven: boolean;
  /** Why it is not proven. Absent when `proven` is true. */
  reason?: string;
}

/**
 * A `capture` proof is rejected when its sentence is not actually a
 * sentence: the path repeated, or the single word "captured" (B1090 — a
 * capture nobody compares proves only that a page still returns bytes).
 * Both failures share one shape — no whitespace, i.e. one token rather than
 * words describing a difference — so one check catches both without having
 * to special-case the literal string "captured" or guess at file
 * extensions.
 */
export function checkCapture(proof: Extract<Proof, { kind: "capture" }>, repoRoot = REPO): ItemResult["reason"] | undefined {
  const observed = proof.observed.trim();
  if (!observed) return "capture proof has no observed difference";
  if (!/\s/.test(observed)) {
    return `capture's observed difference ("${proof.observed}") reads as a file path or a single word, not a sentence`;
  }
  // Repo-relative, and refused if it is not. An absolute path passed the
  // check on the machine that wrote it and failed in every worktree and on
  // every other clone (2026-09-20), which is the worst shape a proof can
  // have: true for its author, false for everybody verifying it.
  if (path.isAbsolute(proof.path)) {
    return `capture path must be relative to the repository root, not absolute: ${proof.path}`;
  }
  const file = path.join(repoRoot, proof.path);
  if (!fs.existsSync(file)) return `capture screenshot does not exist: ${proof.path}`;
  // Present on disk is not enough: it has to be COMMITTED. Three proofs
  // (D6, H1, H3) counted as proven for a day on captures that lived only in
  // the reviewer's own worktree under a gitignored path, and would have
  // failed on any fresh clone. A proof whose evidence only its author can
  // see is the exact failure this gate exists to prevent, one level up from
  // the code it checks.
  const tracked = spawnSync("git", ["ls-files", "--error-unmatch", "--", proof.path], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (tracked.status !== 0) {
    return `capture screenshot is not committed, so nobody else can check it: ${proof.path}`;
  }
  return undefined;
}

/**
 * An `absent` proof is only proof while the grep it names still returns
 * nothing. Runs the grep for real on every check — a proof that was true
 * when it was written and has since regressed must fail here, not pass on
 * the strength of having once been checked by a person.
 */
export function checkAbsent(proof: Extract<Proof, { kind: "absent" }>, repoRoot = REPO): ItemResult["reason"] | undefined {
  if (proof.paths.length === 0) return "absent proof names no paths to check";
  for (const relPath of proof.paths) {
    const target = path.isAbsolute(relPath) ? relPath : path.join(repoRoot, relPath);
    if (!fs.existsSync(target)) return `absent proof names a path that does not exist: ${relPath}`;
  }
  const targets = proof.paths.map((p) => (path.isAbsolute(p) ? p : path.join(repoRoot, p)));
  const res = spawnSync("grep", ["-rnE", "--", proof.grep, ...targets], { encoding: "utf8" });
  // grep exits 0 when it found a match (the thing must be absent and is not),
  // 1 when it found nothing (the claim holds), 2+ on a real error.
  if (res.status === 0) {
    const firstLine = res.stdout.trim().split("\n")[0];
    return `grep "${proof.grep}" still matches: ${firstLine}`;
  }
  if (res.status !== 1) {
    return `grep "${proof.grep}" could not run: ${res.stderr.trim() || `exit ${res.status}`}`;
  }
  return undefined;
}

interface VitestJsonReport {
  testResults: {
    assertionResults: { fullName: string; status: string }[];
  }[];
}

/**
 * Runs the whole suite once, through vitest's own `--reporter=json`, and
 * returns the pass/fail state of every test by its full name. This is the
 * "reuse vitest's own JSON reporter output rather than re-running or
 * re-implementing anything" the ticket asks for: the gate never parses a
 * `.test.ts` file or re-derives what "passed" means, it asks vitest and
 * reads the structured answer.
 *
 * Only called when the manifest actually has a `test` proof to check —
 * which is never, on the day this ships — so the common case never pays for
 * a suite run.
 *
 * `files` scopes the run to the test files the manifest's own `test` proofs
 * name, which is why a proof is required to carry one. Unscoped, a single
 * `test` proof cost a full-suite run — 8,200 tests and a load average in the
 * fifties to answer a question about four test names (2026-09-19). Scoped, it
 * is seconds.
 */
function runVitestJson(repoRoot: string, files: string[] = []): VitestJsonReport {
  const outFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "studio-check-")), "report.json");
  const res = spawnSync("npx", ["vitest", "run", ...files, "--reporter=json", `--outputFile=${outFile}`], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (!fs.existsSync(outFile)) {
    throw new Error(`vitest did not write a JSON report: ${res.stderr || res.stdout}`);
  }
  const report = JSON.parse(fs.readFileSync(outFile, "utf8")) as VitestJsonReport;
  fs.rmSync(path.dirname(outFile), { recursive: true, force: true });
  return report;
}

export function checkTest(
  proof: Extract<Proof, { kind: "test" }>,
  results: Map<string, string>,
): ItemResult["reason"] | undefined {
  const status = results.get(proof.name);
  if (status === undefined) return `no test named "${proof.name}" was found in the last run`;
  if (status !== "passed") return `test "${proof.name}" did not pass (status: ${status})`;
  return undefined;
}

export async function checkManifest(
  manifestPath: string,
  repoRoot = REPO,
  vitestFiles: string[] = [],
): Promise<ItemResult[]> {
  const mod = (await import(new URL(`file://${path.resolve(manifestPath)}`).href)) as { manifest: ManifestItem[] };
  const items = mod.manifest;

  // The files to run are the ones the proofs themselves name — never the
  // whole suite. An explicit `vitestFiles` (this script's own tests) wins.
  const provenFiles = [...new Set(items.flatMap((item) => (item.proof?.kind === "test" ? [item.proof.file] : [])))];
  const filesToRun = vitestFiles.length > 0 ? vitestFiles : provenFiles;
  let testResults = new Map<string, string>();
  if (provenFiles.length > 0) {
    const report = runVitestJson(repoRoot, filesToRun);
    testResults = new Map(
      report.testResults.flatMap((file) => file.assertionResults.map((a) => [a.fullName, a.status] as const)),
    );
  }

  return items.map((item) => {
    if (item.proof === null) return { id: item.id, proven: false, reason: "no proof yet" };
    const reason =
      item.proof.kind === "capture"
        ? checkCapture(item.proof, repoRoot)
        : item.proof.kind === "absent"
          ? checkAbsent(item.proof, repoRoot)
          : checkTest(item.proof, testResults);
    return reason ? { id: item.id, proven: false, reason } : { id: item.id, proven: true };
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flagIndex = args.indexOf("--manifest");
  const manifestPath =
    flagIndex >= 0 && args[flagIndex + 1] ? args[flagIndex + 1] : path.join(REPO, "test", "studio", "conformance.manifest.ts");
  // Override for this script's own tests, which point the run at one fixture
  // file. A real check derives its files from the manifest's proofs instead.
  const vitestFiles = args.flatMap((arg, i) => (arg === "--vitest-files" ? [args[i + 1]] : [])).filter(Boolean) as string[];

  const results = await checkManifest(manifestPath, REPO, vitestFiles);
  const proven = results.filter((r) => r.proven);
  const outstanding = results.filter((r) => !r.proven);

  console.log(`${proven.length} of ${results.length} proven`);
  if (outstanding.length > 0) {
    console.log(`outstanding: ${outstanding.map((r) => r.id).join(" ")}`);
    for (const r of outstanding) {
      if (r.reason && r.reason !== "no proof yet") console.log(`  ${r.id}: ${r.reason}`);
    }
  }

  process.exit(outstanding.length > 0 ? 1 : 0);
}

// Only run as a CLI when invoked directly — `npm run studio:check`, or a
// test spawning this file — never on import, so `checkManifest` and the
// per-kind checkers stay usable as plain functions from tests.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.stack || err.message : String(err));
    process.exit(2);
  });
}
