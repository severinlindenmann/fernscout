// Copies content/example/ to a new user, so a fresh clone has a journal of its
// own to edit rather than an empty folder.
//
//   npm run seed:example -- --user <username>
//   npm run seed:example -- --user <username> --force
//
// content/example/ stays where it is and keeps serving at /example: it is the
// live reference, not a template that gets consumed. It holds no personal data
// and no real photographs — only generated placeholders.
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(import.meta.dirname, "..");
const SRC = path.join(ROOT, "content", "example");
const args = process.argv.slice(2);
const userFlag = args.indexOf("--user");
const username = userFlag >= 0 ? args[userFlag + 1] : undefined;

if (!username || !/^[a-z0-9][a-z0-9-]{1,30}$/.test(username)) {
  console.error("Usage: npm run seed:example -- --user <username> [--force]");
  process.exit(1);
}
const DEST = path.join(ROOT, "content", username);
const force = args.includes("--force");

if (!fs.existsSync(SRC)) {
  console.error(`No example user at ${SRC}`);
  process.exit(1);
}

if (fs.existsSync(DEST) && !force) {
  console.error(
    `content/${username}/ already exists. This would overwrite real content.\n` +
      "Re-run with --force if that is genuinely what you want.",
  );
  process.exit(1);
}

fs.cpSync(SRC, DEST, { recursive: true });
console.log(`Copied ${path.relative(ROOT, SRC)} → ${path.relative(ROOT, DEST)}`);
console.log(`Run \`npm run dev\` and open http://localhost:3000/${username}`);
console.log(`Then set site.defaultUser to "${username}" in content/config.json to own the bare domain.`);
