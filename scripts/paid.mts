/**
 * Runs a script that lives in paid/ — open core.
 *
 *   tsx scripts/paid.mts photobook/scripts/photobook-reconcile.mts [args…]
 *
 * package.json keeps every script name; the ones whose code moved to paid/
 * go through here. Without paid/ (the public build) it says so and exits 0,
 * because a systemd timer calls some of them (photobook:reconcile every five
 * minutes) and "not in this build" is not a failure.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [script, ...rest] = process.argv.slice(2);
if (!script) {
  console.error("usage: tsx scripts/paid.mts <path under paid/> [args…]");
  process.exit(2);
}
const file = path.join(process.cwd(), "paid", script);
if (!fs.existsSync(file)) {
  console.log(`${script}: not included in this build`);
  process.exit(0);
}
// The script sees itself as the entry point, exactly as if run directly.
process.argv = [process.argv[0], file, ...rest];
await import(pathToFileURL(file).href);
