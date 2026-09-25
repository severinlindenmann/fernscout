/**
 * Refreshes this instance's European Central Bank reference rates.
 *
 *   npm run rates:update
 *   npm run rates:update -- --dry-run
 *   npm run rates:update -- --pair THB --base CHF --on 2026-03-14
 *
 * Run nightly by `scripts/backup.sh` step 0 — the one thing on the box that
 * already runs every night and already reports its own failures (B1084). Also
 * runnable by hand, which is the only way it ran before.
 *
 * **Two judgements live here rather than in the shell that calls it**, because
 * both need to read this instance's own configuration:
 *
 *   1. **Where it writes.** `<DATA_DIR>/rates/ecb.json`, from
 *      `ecbCacheWritePath()`, and never the checkout. This table used to be
 *      committed at `site/rates/ecb.json`; refreshing that in place on a
 *      server would leave `/srv/fernscout` dirty and the next `git pull` in
 *      `scripts/deploy.sh` would refuse to run. It is a measurement with a
 *      date on it, which is instance state, not source.
 *
 *   2. **Whether it runs at all.** Nothing here happens on an instance with
 *      `costs` switched off. The rates exist to convert a trip's base currency
 *      into whatever a reader picked, and an instance that does not do money
 *      has nothing to convert — so it should not be reaching the ECB every
 *      night, and should not be holding a file it never reads. An optional
 *      capability that is off must be *absent* rather than idling.
 *
 * The parsing and the read-only `--pair` lookup stay in
 * `scripts/update-rates.mjs`: that half needs no configuration, no capability
 * and no disk, and it is covered by its own tests.
 *
 * Run through `tsx --conditions=react-server` (see package.json), for the same
 * reason `npm run rates:fill` is: the modules it reaches are `server-only`.
 */
import fs from "node:fs";
import path from "node:path";
import { isEnabled } from "../lib/capabilities";
import { ecbCacheWritePath } from "../lib/rates";
import { DAILY_URL, parseEcbXml, printCrossRate } from "./update-rates.mjs";

/**
 * What `--pair` needs; anything less falls through to the refresh.
 *
 * `on` is present-but-possibly-undefined rather than optional, because
 * `printCrossRate` comes from an untyped `.mjs` and TypeScript infers its
 * parameter as having all three keys.
 */
function lookupArgs(
  argv: string[],
): { pair: string; base: string; on: string | undefined } | null {
  const value = (flag: string) => {
    const at = argv.indexOf(flag);
    return at === -1 ? undefined : argv[at + 1];
  };
  const pair = value("--pair");
  const base = value("--base");
  if (!pair || !base) return null;
  // Upper-cased here, as the old CLI did: currency codes are upper case and
  // nobody types them that way.
  return { pair: pair.toUpperCase(), base: base.toUpperCase(), on: value("--on") };
}

async function refresh({ dryRun }: { dryRun: boolean }): Promise<number> {
  // Absent, not idling. Said out loud rather than exiting quietly, because a
  // nightly job that prints nothing is one nobody can tell apart from a
  // nightly job that is not running (B138, and B1085 next door).
  if (!isEnabled("costs")) {
    console.log(
      "costs is switched off on this instance, so there is nothing to convert — " +
        "no rates fetched and none written.",
    );
    return 0;
  }

  let xml: string;
  try {
    const res = await fetch(DAILY_URL, { headers: { accept: "application/xml" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    xml = await res.text();
  } catch (err) {
    // The previous table stays exactly as it was. A night without the internet
    // must leave yesterday's rate in place, not blank the conversions: an
    // approximate figure with a disclosed date beats no figure at all.
    console.error(`Could not reach the ECB: ${(err as Error).message}`);
    console.error("The rates already on disk are left exactly as they were.");
    return 1;
  }

  const { date, rates } = parseEcbXml(xml);
  const snapshot = {
    source: "European Central Bank euro foreign exchange reference rates",
    url: DAILY_URL,
    base: "EUR",
    // The ECB's own publication date, which is what the site cites — not the
    // day this script happened to run. They differ over a weekend, and the
    // page tells the reader which it is.
    date,
    fetchedAt: new Date().toISOString(),
    note: "Units of each currency for one euro.",
    rates: Object.fromEntries(Object.entries(rates).sort(([a], [b]) => a.localeCompare(b))),
  };

  const file = ecbCacheWritePath();
  if (!dryRun) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(snapshot, null, 2)}\n`);
  }
  console.log(
    `${dryRun ? "Would write" : "Wrote"} ${Object.keys(rates).length} rates for ${date}: ${file}`,
  );
  return 0;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  // A partial lookup is refused rather than quietly becoming a refresh. Asking
  // for `--pair THB` and getting a full rates fetch — network, disk and all —
  // is the kind of surprise that makes somebody distrust the whole script.
  const partial = ["--pair", "--base", "--on"].some((f) => argv.includes(f));
  if (partial && !lookupArgs(argv)) {
    console.error("--pair, --base and --on are only meaningful together.");
    console.error("  npm run rates:update -- --pair THB --base CHF --on 2026-03-14");
    process.exitCode = 1;
    return;
  }

  const lookup = lookupArgs(argv);
  if (lookup) {
    // Read-only, writes nothing, and deliberately not gated on `costs`: it
    // hands an author the number to freeze into a trip's own rates block, and
    // that is a judgement about what a trip cost rather than a live conversion.
    process.exitCode = (await printCrossRate(lookup)) ? 0 : 1;
    return;
  }
  process.exitCode = await refresh({ dryRun: argv.includes("--dry-run") });
}

await main();
