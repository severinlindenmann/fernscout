/**
 * Rewrites a user's `content/<username>/config.json` from the shape W37
 * replaced — `travellers[]` plus a separate `ownerEmail` — to the single
 * `owner: { name, nickname, email? }` the parser now requires.
 *
 *   node scripts/migrate-owner.ts --user <username> [--dry-run]
 *   node scripts/migrate-owner.ts --all [--dry-run]
 *
 * Before:
 *   "ownerEmail": "alex@example.com",
 *   "travellers": [
 *     { "name": "Alex Berger", "nickname": "Alex" },
 *     { "name": "Robin Berger", "nickname": "Robin" }
 *   ]
 *
 * After:
 *   "owner": { "name": "Alex Berger", "nickname": "Alex", "email": "alex@example.com" }
 *
 * `travellers[0]` becomes the owner. Anyone after that is not carried over —
 * they belong in the relevant trip's `people:` block in `trip.md` now, which
 * is what decides who a trip is credited to since W37. This script warns
 * about each of them by name rather than dropping them quietly.
 *
 * Idempotent: a config that already has `owner` is left completely alone.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Writes `contents` to `configPath` atomically: write a temp file in the same
 * directory (so it's the same filesystem, which is what makes the rename
 * atomic on POSIX), then `renameSync` over the original.
 *
 * This file lives outside the repository and the server it runs on keeps no
 * backups of it on purpose (see docs/runbook.md) — a plain in-place
 * `writeFileSync` leaves a truncated, unrecoverable config behind if the
 * process is killed mid-write (OOM, SIGKILL, a full disk). The temp-then-
 * rename sequence means a crash before the rename leaves the *original* file
 * intact and an orphaned temp file next to it, never a damaged config. If the
 * write to the temp file itself throws, the temp file is removed before the
 * error propagates, so a failed attempt doesn't litter the content folder.
 */
function writeConfigAtomic(configPath: string, contents: string) {
  const dir = path.dirname(configPath);
  const tmp = path.join(dir, `.${path.basename(configPath)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`);
  try {
    fs.writeFileSync(tmp, contents);
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      // Best effort — the write already failed, and the write's own error is
      // the one worth surfacing.
    }
    throw err;
  }
  fs.renameSync(tmp, configPath);
}

const args = process.argv.slice(2);
const dry = args.includes("--dry-run");
const all = args.includes("--all");
const userFlag = args.indexOf("--user");
const username = userFlag >= 0 ? args[userFlag + 1] : undefined;

const ROOT = path.join(import.meta.dirname, "..");
const CONTENT = process.env.CONTENT_DIR ?? path.join(ROOT, "content");

/** Same shape as a trip id: lowercase, digits, dashes, no leading dash. */
const USERNAME_RE = /^[a-z0-9][a-z0-9-]{1,30}$/;

/** Not people: shared currency rates, shared UI dictionaries. Mirrors
 * lib/users.ts's INSTANCE_DIRS — kept as a local copy because this script
 * runs standalone, outside the app's module graph. */
const INSTANCE_DIRS = new Set(["rates", "locales"]);

function usage(): never {
  console.error(
    "Usage: node scripts/migrate-owner.ts --user <username> [--dry-run]\n" +
      "       node scripts/migrate-owner.ts --all [--dry-run]",
  );
  process.exit(1);
}

if (!username && !all) usage();
if (username && all) usage();
if (username && !USERNAME_RE.test(username)) usage();

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Every directory under the content root that looks like a user, in the
 * same spirit as `lib/users.ts#getUsernames` — but standalone. */
function listUsernames(): string[] {
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(CONTENT, { withFileTypes: true });
  } catch {
    return [];
  }
  const names: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    if (name.startsWith(".") || INSTANCE_DIRS.has(name)) continue;
    if (!USERNAME_RE.test(name)) continue;
    if (!fs.existsSync(path.join(CONTENT, name, "config.json"))) continue;
    names.push(name);
  }
  names.sort();
  return names;
}

type Traveller = { name: string; nickname?: string };

type MigrationResult =
  | { config: Record<string, unknown>; owner: Record<string, unknown>; extraTravellers: Traveller[] }
  | { error: string };

/**
 * Builds the migrated config object from the raw parsed JSON.
 *
 * Rebuilds key-by-key rather than constructing a fresh object, so every key
 * this script doesn't touch stays exactly where it was — the file is one a
 * person may have hand-edited and possibly committed.
 */
function migrateConfig(raw: Record<string, unknown>): MigrationResult {
  const travellers = raw.travellers;
  const hasTravellers = Array.isArray(travellers) && travellers.length > 0;
  if (!hasTravellers) {
    return { error: "has no travellers[] (or an empty one) — there is no name to build an owner from" };
  }
  const list = travellers as unknown[];
  const first = list[0];
  if (!isRecord(first) || typeof first.name !== "string" || first.name.trim() === "") {
    return { error: "travellers[0] has no usable name field" };
  }

  const ownerName = first.name;
  // Never invent a nickname by splitting a name on whitespace: use the given
  // nickname, or fall back to the full name verbatim.
  const ownerNickname =
    typeof first.nickname === "string" && first.nickname.trim() !== "" ? first.nickname : ownerName;

  const owner: Record<string, unknown> = { name: ownerName, nickname: ownerNickname };
  const ownerEmail = raw.ownerEmail;
  if (typeof ownerEmail === "string" && ownerEmail.trim() !== "") {
    owner.email = ownerEmail;
  }

  const extraTravellers: Traveller[] = list.slice(1).map((t) => {
    if (isRecord(t) && typeof t.name === "string" && t.name.trim() !== "") {
      const nickname = typeof t.nickname === "string" && t.nickname.trim() !== "" ? t.nickname : undefined;
      return { name: t.name, nickname };
    }
    return { name: `(unnamed entry: ${JSON.stringify(t)})` };
  });

  // Replace whichever of travellers/ownerEmail appears first with "owner",
  // drop the other, and leave every other key exactly where it was.
  const config: Record<string, unknown> = {};
  let inserted = false;
  for (const key of Object.keys(raw)) {
    if (key === "travellers" || key === "ownerEmail") {
      if (!inserted) {
        config.owner = owner;
        inserted = true;
      }
      continue;
    }
    config[key] = raw[key];
  }
  if (!inserted) config.owner = owner;

  return { config, owner, extraTravellers };
}

const say = (what: string) => console.log(`${dry ? "[dry-run] " : ""}${what}`);

type Outcome = "migrated" | "already-migrated" | "skipped" | "failed";

function migrateOne(user: string): Outcome {
  const configPath = path.join(CONTENT, user, "config.json");
  if (!fs.existsSync(configPath)) {
    console.warn(`${user}: no config.json at ${configPath} — skipping.`);
    return "failed";
  }

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (err) {
    console.warn(`${user}: config.json is not valid JSON — skipping. (${(err as Error).message})`);
    return "failed";
  }
  if (!isRecord(raw)) {
    console.warn(`${user}: config.json does not contain a JSON object — skipping.`);
    return "failed";
  }

  if (raw.owner !== undefined) {
    console.log(`${user}: already has "owner" — already migrated, left untouched.`);
    return "already-migrated";
  }

  const result = migrateConfig(raw);
  if ("error" in result) {
    console.warn(`${user}: ${result.error} — leaving config.json untouched.`);
    return "skipped";
  }

  const { config, owner, extraTravellers } = result;

  for (const t of extraTravellers) {
    console.warn(
      `${user}: traveller "${t.name}" is dropped from config.json's travellers[] and is NOT carried into ` +
        `owner. Add them to the relevant trip's people: block in trip.md instead, e.g.:\n` +
        `    - { name: "${t.name}", email: "...", nickname: "${t.nickname ?? t.name}" }`,
    );
  }

  say(`${user}: migrate config.json`);
  say(`  owner: ${JSON.stringify(owner, null, 2).replace(/\n/g, "\n  ")}`);

  if (!dry) {
    try {
      writeConfigAtomic(configPath, JSON.stringify(config, null, 2) + "\n");
    } catch (err) {
      console.warn(
        `${user}: failed to write config.json (${(err as Error).message}) — original file left untouched.`,
      );
      return "failed";
    }
  }

  return "migrated";
}

const usernames = all ? listUsernames() : [username as string];

if (all && usernames.length === 0) {
  console.log(`Nothing to do: no user config.json files found under ${CONTENT}.`);
  process.exit(0);
}

let migrated = 0;
let alreadyMigrated = 0;
let problems = 0;

for (const user of usernames) {
  const outcome = migrateOne(user);
  if (outcome === "migrated") migrated++;
  else if (outcome === "already-migrated") alreadyMigrated++;
  else problems++;
}

console.log("");
console.log(
  `Summary: ${migrated} migrated, ${alreadyMigrated} already on owner, ${problems} need attention.`,
);
if (dry && migrated > 0) {
  console.log("Nothing was changed. Re-run without --dry-run to apply.");
}

process.exit(problems > 0 ? 1 : 0);
