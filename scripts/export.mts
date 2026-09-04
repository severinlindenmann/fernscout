/**
 * Full backup of one user's content, as a zip `content/<username>/` could be
 * restored from — the anti-lock-in pitch, made concrete.
 *
 *   npm run export -- severin
 *   npm run export -- severin --out ~/backups/severin-2026-08-30.zip
 *
 * A local/operator tool, not an HTTP endpoint: it includes every trip exactly
 * as it sits on disk, closed ones included, so it is the same trust level as
 * `npm run db:migrate` — whoever can run this already has filesystem access to
 * content/. The public `/<username>/export.zip` route
 * (app/[user]/export.zip/route.ts) shares the same lib/exportZip.ts machinery
 * but with the `"open-to-link"` scope, which drops every trip that is not
 * `public` instead of trusting the requester.
 *
 * Run with `npm run export`, not `tsx scripts/export.mts` directly: several
 * lib/ modules this pulls in (lib/users.ts, lib/access.ts) import
 * `server-only`, which throws unless the `react-server` export condition is
 * active — normally supplied by Next's bundler, here by the npm script's
 * `--conditions=react-server` flag (the same problem test/ solves with the
 * `server-only` alias in vitest.config.mts).
 */
import fs from "node:fs";
import path from "node:path";
import { buildUserExportZipBuffer } from "../lib/exportZip";
import { getUsernames } from "../lib/users";

function parseArgs(argv: string[]): { username?: string; out?: string } {
  const out: { username?: string; out?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--out") {
      out.out = argv[++i];
    } else if (!token.startsWith("--") && !out.username) {
      out.username = token;
    }
  }
  return out;
}

async function main() {
  const { username, out } = parseArgs(process.argv.slice(2));

  if (!username) {
    console.error("Usage: npm run export -- <username> [--out <file.zip>]");
    console.error("Without --out it writes to exports/<username>-<date>.zip.");
    const known = getUsernames();
    if (known.length > 0) console.error(`Known users: ${known.join(", ")}`);
    process.exit(1);
  }

  if (!getUsernames().includes(username)) {
    console.error(
      `No such user: "${username}". Known users: ${getUsernames().join(", ") || "(none)"}`,
    );
    process.exit(1);
  }

  // Default into `exports/`, which is gitignored, and dated so a second run
  // does not silently replace the first.
  //
  // It used to default to the working directory — the repository root, for
  // `npm run export` — which is how somebody's entire journal, private trips
  // and all, came to be committed. A backup command whose default is "drop it
  // where the source code is" gets that wrong once and it is in the history
  // for good.
  const today = new Date().toISOString().slice(0, 10);
  const outPath = path.resolve(out ?? path.join("exports", `${username}-${today}.zip`));
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const buffer = await buildUserExportZipBuffer(username, "all");
  fs.writeFileSync(outPath, buffer);
  console.log(`Wrote ${outPath} (${buffer.length.toLocaleString()} bytes).`);
  console.log(`Restore with: unzip ${path.basename(outPath)} -d content/${username}`);
}

main();
