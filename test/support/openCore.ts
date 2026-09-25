import fs from "node:fs";
import path from "node:path";

/**
 * Open core: a route file under app/ may be a one-line shell that re-exports
 * its implementation from `@paid/…` (open-core/split). Source-scan keepers
 * read the file that holds the code: the route itself, its paid/
 * implementation when this checkout has paid/, or nothing when this build
 * does not carry that feature (the shell then falls back to a stub that
 * answers 404, which has nothing to scan).
 */
const SHELL = /^export \{[^}]*\} from "@paid\/([^"]+)";/;

export function routeImplementation(file: string): string | null {
  const match = SHELL.exec(fs.readFileSync(file, "utf8"));
  if (!match) return file;
  for (const ext of [".tsx", ".ts"]) {
    const real = path.join(process.cwd(), "paid", match[1] + ext);
    if (fs.existsSync(real)) return real;
  }
  return null;
}

/** The source to scan for a route file, or null when this build lacks it. */
export function routeSource(file: string): string | null {
  const real = routeImplementation(file);
  return real ? fs.readFileSync(real, "utf8") : null;
}

/**
 * Whether this checkout carries paid/ at all. For a test moved back to the
 * public tree by manifest.json's `creditsLedgerPublic` switch (open-core/
 * split/split.mjs) that still has one or two cases pinning genuinely paid-only
 * behaviour (a real WhatsApp cost, postcard/photobook/print tool names) — use
 * `test.skipIf(!hasPaid())(...)` on those specific cases rather than the whole
 * file, so the rest of the file keeps proving the now-public code for real.
 */
export function hasPaid(): boolean {
  return fs.existsSync(path.join(process.cwd(), "paid"));
}

/**
 * A core folder's counterparts in paid/, when paid/ is present: `lib/x` →
 * `paid/<area>/lib/x`, `app/x` → `paid/<area>/routes/x`. A keeper that walks a
 * core folder walks these too, so moving code into paid/ never moves it out
 * of the keeper's reach in the paid build.
 */
export function paidCounterparts(dir: string): string[] {
  const paid = path.join(process.cwd(), "paid");
  if (!fs.existsSync(paid)) return [];
  return fs
    .readdirSync(paid, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== "test")
    .map((e) => (dir.startsWith("app/") ? path.join(paid, e.name, "routes", dir.slice(4)) : path.join(paid, e.name, dir)))
    .filter((d) => fs.existsSync(d));
}
