/**
 * Moves a single-user content folder into the multi-user layout.
 *
 *   node scripts/migrate-users.ts --user <username> --dry-run
 *   node scripts/migrate-users.ts --user <username>
 *
 * Before:  content/{config.json,trips/<id>/…}
 * After:   content/config.json           (server settings)
 *          content/<user>/config.json    (personal settings)
 *          content/<user>/trips/<id>/…
 *
 * Idempotent: a folder that is already migrated is left alone.
 */
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const dry = args.includes("--dry-run");
const userFlag = args.indexOf("--user");
const username = userFlag >= 0 ? args[userFlag + 1] : undefined;

const ROOT = path.join(import.meta.dirname, "..");
const CONTENT = process.env.CONTENT_DIR ?? path.join(ROOT, "content");

if (!username || !/^[a-z0-9][a-z0-9-]{1,30}$/.test(username)) {
  console.error("Usage: node scripts/migrate-users.ts --user <username> [--dry-run]");
  process.exit(1);
}

const oldTrips = path.join(CONTENT, "trips");
const newUserDir = path.join(CONTENT, username);

if (!fs.existsSync(oldTrips)) {
  console.log(`Nothing to do: ${oldTrips} does not exist (already migrated?).`);
  process.exit(0);
}

const say = (what: string) => console.log(`${dry ? "[dry-run] " : ""}${what}`);

say(`move ${oldTrips} -> ${path.join(newUserDir, "trips")}`);
if (!dry) {
  fs.mkdirSync(newUserDir, { recursive: true });
  fs.renameSync(oldTrips, path.join(newUserDir, "trips"));
}

// Split config.json: personal keys to the user, deployment keys to the server.
const configPath = path.join(CONTENT, "config.json");
if (fs.existsSync(configPath)) {
  const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const site = raw.site ?? {};
  const features = raw.features ?? {};

  const userConfig = {
    title: site.title ?? username,
    tagline: site.tagline ?? "",
    travellers: site.travellers ?? [],
    startLocation: site.startLocation ?? "",
    defaultLocale: site.defaultLocale ?? "en",
    locales: site.locales ?? ["en"],
    baseCurrency: site.baseCurrency ?? "CHF",
    displayCurrencies: site.displayCurrencies ?? ["CHF"],
    ...(site.manualRates ? { manualRates: site.manualRates } : {}),
    units: site.units ?? "metric",
    features: {
      reactions: features.reactions ?? { enabled: true },
      costs: features.costs ?? { enabled: true },
      push: features.push ?? { enabled: false },
      postcards: features.postcards ?? { enabled: false },
    },
  };

  const serverConfig = {
    site: {
      name: site.title ?? "Fernscout",
      url: site.url ?? "http://localhost:3000",
      defaultUser: username,
    },
    users: { reserved: [] as string[] },
    features: {
      mail: features.mail ?? { enabled: false, transport: "file" },
      auth: features.auth ?? { enabled: false },
      contacts: features.contacts ?? { enabled: false },
      postcards: features.postcards ?? { enabled: false, provider: "dry-run" },
      photobook: features.photobook ?? { enabled: false, provider: "dry-run" },
    },
  };

  say(`write ${path.join(newUserDir, "config.json")}`);
  say(`rewrite ${configPath} as server settings`);
  if (!dry) {
    fs.mkdirSync(newUserDir, { recursive: true });
    fs.writeFileSync(
      path.join(newUserDir, "config.json"),
      JSON.stringify(userConfig, null, 2) + "\n",
    );
    fs.writeFileSync(configPath, JSON.stringify(serverConfig, null, 2) + "\n");
  }
}

say("done");
if (dry) console.log("\nNothing was changed. Re-run without --dry-run to apply.");
