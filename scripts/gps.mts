/**
 * The GPS command — B665.
 *
 *   npm run gps -- formats
 *   npm run gps -- import <user> <file> [--format <id>] [--dry-run]
 *   npm run gps -- enrich <user>/<trip> [--dry-run]
 *
 * `import` reads somebody's location export into the private store
 * (`lib/gps/store.ts`); `enrich` derives one trip's own line from it
 * (`lib/gps/enrich.ts`). They are separate steps because they answer to
 * different decisions: the first is the owner handing over their history, the
 * second is about one trip, and the second still works for years after the
 * first has been deleted.
 *
 * A CLI rather than a route on purpose. The store is served by nothing, and
 * the way in should not be an exception to that.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { appendFixes } from "../lib/gps/store.ts";
import { readExcludeZones, trackForTrip } from "../lib/gps/enrich.ts";
import { trackPointCount, trackFile, writeTrack } from "../lib/gps/track.ts";
import { getTrip } from "../lib/trips.ts";
import { checkGpsImporter, type Fix, type GpsImporter } from "../importers/gps/schema.ts";

/** Positions only. A future costs command reads `importers/costs/` — the
 * folder is the kind, so nothing here has to filter a shared pile. */
const IMPORTERS_DIR = path.join(process.cwd(), "importers", "gps");
/** What `detect` is shown. Enough for any format to recognise itself, small
 * enough not to hold a gigabyte export in memory twice. */
const HEAD_BYTES = 64 * 1024;

/**
 * Every importer in `importers/gps/`, discovered rather than listed.
 *
 * The folder is the registry: drop a file in and it works, with no list here
 * to edit. That is what makes the folder's MIT licence worth anything —
 * somebody's own importer is a file they copy in, not a patch to this
 * repository.
 */
async function loadImporters(): Promise<GpsImporter[]> {
  const out: GpsImporter[] = [];
  for (const name of fs.readdirSync(IMPORTERS_DIR).sort()) {
    if (!name.endsWith(".ts") || name === "schema.ts") continue;
    const loaded: unknown = await import(
      pathToFileURL(path.join(IMPORTERS_DIR, name)).href
    );
    const importer = (loaded as { default?: GpsImporter }).default;
    if (!importer?.id || typeof importer.parse !== "function") {
      console.warn(`  ${name}: no importer exported, skipped`);
      continue;
    }
    out.push(importer);
  }
  return out;
}

function readHead(file: string): string {
  const handle = fs.openSync(file, "r");
  try {
    const buffer = Buffer.alloc(HEAD_BYTES);
    const read = fs.readSync(handle, buffer, 0, HEAD_BYTES, 0);
    return buffer.subarray(0, read).toString("utf8");
  } finally {
    fs.closeSync(handle);
  }
}

function span(fixes: Fix[]): string {
  if (fixes.length === 0) return "nothing";
  const times = fixes.map((f) => f.t);
  const from = new Date(Math.min(...times)).toISOString().slice(0, 10);
  const to = new Date(Math.max(...times)).toISOString().slice(0, 10);
  return `${from} → ${to}`;
}

async function commandFormats(): Promise<void> {
  for (const importer of await loadImporters())
    console.log(`  ${importer.id.padEnd(20)} ${importer.label}`);
}

async function commandImport(argv: string[]): Promise<void> {
  const [username, file] = argv.filter((a) => !a.startsWith("--"));
  const dryRun = argv.includes("--dry-run");
  const wanted = argv[argv.indexOf("--format") + 1];
  if (!username || !file) throw new Error("usage: gps import <user> <file> [--format <id>]");
  if (!fs.existsSync(file)) throw new Error(`no such file: ${file}`);

  const importers = await loadImporters();
  const head = readHead(file);
  const name = path.basename(file);
  const chosen = argv.includes("--format")
    ? importers.find((i) => i.id === wanted)
    : importers.find((i) => i.detect(head, name));
  if (!chosen)
    throw new Error(
      argv.includes("--format")
        ? `no importer called ${wanted} — try: gps formats`
        : `nothing recognised ${name}. Try --format <id>, or gps formats`,
    );

  console.log(`${name} → ${chosen.label}`);
  const fixes = chosen.parse(fs.readFileSync(file, "utf8"));
  console.log(`  read ${fixes.length} fixes, ${span(fixes)}`);

  // The same `checkGpsImporter` a contributor calls directly — so somebody
  // writing an importer can point this command at their own export and be told
  // what is wrong with it, rather than finding out from a map of the Gulf of
  // Guinea a week later.
  const problems = checkGpsImporter(chosen, fixes);
  for (const problem of problems) console.log(`  ! ${problem}`);
  if (problems.length > 0) throw new Error(`${chosen.id} does not hold up the contract`);

  if (dryRun) {
    console.log("  --dry-run: contract holds, nothing written");
    return;
  }
  const result = appendFixes(username, fixes);
  console.log(
    `  store now holds ${result.after} fixes for these months (was ${result.before}), thinned to 5 min / 250 m`,
  );
  console.log(`  ${result.months.join(", ")}`);
}

async function commandEnrich(argv: string[]): Promise<void> {
  const [ref] = argv.filter((a) => !a.startsWith("--"));
  const dryRun = argv.includes("--dry-run");
  if (!ref?.includes("/")) throw new Error("usage: gps enrich <user>/<trip>");
  const [username] = ref.split("/");
  const trip = getTrip(ref);
  if (!trip) throw new Error(`no such trip: ${ref}`);

  const zones = readExcludeZones(username);
  console.log(`${trip.title} — ${trip.start} → ${trip.end}, ${zones.length} private zones`);
  const track = trackForTrip(username, { start: trip.start, end: trip.end, zones });
  console.log(`  ${track.segments.length} segments, ${trackPointCount(track)} points`);
  if (track.segments.length === 0)
    console.log("  nothing in the store for these dates — no track written");
  else if (dryRun) console.log("  --dry-run: nothing written");
  else {
    writeTrack(username, trip.id, track);
    console.log(`  wrote ${trackFile(username, trip.id)}`);
  }
}

const [command, ...rest] = process.argv.slice(2);
const commands: Record<string, (argv: string[]) => Promise<void>> = {
  formats: commandFormats,
  import: commandImport,
  enrich: commandEnrich,
};
const run = commands[command ?? ""];
if (!run) {
  console.error("usage: gps <formats|import|enrich> …");
  process.exit(1);
}
try {
  await run(rest);
} catch (error) {
  console.error(`gps ${command}: ${(error as Error).message}`);
  process.exit(1);
}
