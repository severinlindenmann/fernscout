/**
 * What is on this instance, in one screen.
 *
 *   npm run status                    # print it
 *   npm run status -- --json          # the same numbers, machine-readable
 *
 * Piped into the nightly mail by `scripts/alert.sh` when the backup succeeded
 * (B464). A failure still mails the journal tail, because a log is the answer
 * to "why did it break" and this is the answer to "what is here".
 *
 * **Nothing here is a new source of truth.** Every count comes from the reader
 * the site itself uses — `getTrips`, `getDays`, `listContacts`, `balanceOf` —
 * so a number in this mail is the number a page would render. Disk is walked
 * rather than tracked, for the reason `lib/api/media.ts` already gives about
 * its quota: a counter is a second truth that drifts the first time somebody
 * deletes a file by hand, on a system whose premise is that the content is a
 * folder you own.
 *
 * **It must not be able to cost the mail.** This runs after a backup that has
 * already finished; a section that throws degrades to a line saying so, and
 * the process still exits 0. `section()` is what enforces that — every block
 * goes through it.
 */
import fs from "node:fs";
import path from "node:path";

import { balanceOf, creditsEnabled } from "../lib/credits";
import { contactsWithReadGrant } from "../lib/grants";
import { getDays } from "../lib/entries";
import { getTrips } from "../lib/trips";
import { getUsernames, getUser, listedUsernames, userDir } from "../lib/users";
import { contentRoot } from "../lib/contentRoot";
import { listContacts } from "../lib/contacts";
import { loadServerConfig } from "../lib/config";
import { getDatabaseOrNull } from "../lib/db";

const asJson = process.argv.includes("--json");

/**
 * Run one block, and never let it be the reason nothing is sent.
 *
 * A journal with a malformed `config.json`, a database that is down, a
 * permission the walk did not expect — every one of those is a line in the
 * report rather than an exception out of it. The failure is *named*: a section
 * that quietly returned nothing would read as "there are none", which is the
 * one wrong answer a status report must not give.
 */
async function section<T>(label: string, fn: () => Promise<T> | T, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    problems.push(`${label}: ${(error as Error).message}`);
    return fallback;
  }
}

const problems: string[] = [];

function bytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(0)} MB`;
  return `${(n / 1024).toFixed(0)} KB`;
}

/** Every byte under a directory. Same walk as lib/api/media.ts's quota. */
function dirBytes(at: string): number {
  let total = 0;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(at, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = path.join(at, entry.name);
    if (entry.isDirectory()) total += dirBytes(full);
    else if (entry.isFile())
      try {
        total += fs.statSync(full).size;
      } catch {
        // Vanished between readdir and stat. Not our byte to count.
      }
  }
  return total;
}

type JournalRow = {
  username: string;
  listed: boolean;
  trips: number;
  tripsByVisibility: Record<string, number>;
  current: string | null;
  days: number;
  drafts: number;
  contacts: number;
  guests: number;
  credits: number | null;
  bytes: number;
};

const listed = new Set(await section("listed journals", () => listedUsernames(), []));
const usernames = await section("journals", () => getUsernames(), []);
const credits = await section("credits", () => creditsEnabled(), false);

/**
 * Contacts, guests and credits all live in the database, and an instance
 * without one is the ordinary case rather than a fault — the prototype tier is
 * the same app with the flags off (docs/runbook.md). Asked once, so a laptop
 * gets one sentence instead of two error lines per journal saying the same
 * thing, and so those columns can be left out rather than printed as zeroes.
 * A zero here would be a claim: "nobody is reading this journal".
 */
const hasDatabase = await section("database", async () => (await getDatabaseOrNull()) !== null, false);

const rows: JournalRow[] = [];
for (const username of usernames) {
  rows.push(
    await section<JournalRow>(
      `journal ${username}`,
      async () => {
        // A journal whose config.json will not parse is listed as a directory
        // but has no readable configuration, and every count below would come
        // back zero — which reads as "an empty journal" rather than "a journal
        // this report could not open". Say which.
        if (!getUser(username)) throw new Error("config.json could not be read");
        const trips = getTrips(username);
        const tripsByVisibility: Record<string, number> = {};
        let days = 0;
        let drafts = 0;
        for (const trip of trips) {
          tripsByVisibility[trip.visibility] = (tripsByVisibility[trip.visibility] ?? 0) + 1;
          // Two reads rather than one: `getDays` filters drafts unless asked,
          // and the difference between the two is the number of days waiting
          // for somebody to look at them — which is the one an owner acts on.
          const published = getDays(trip.ref).length;
          days += published;
          drafts += getDays(trip.ref, { includeDrafts: true }).length - published;
        }
        const contacts = hasDatabase
          ? await section(`${username} contacts`, () => listContacts(username), [])
          : [];
        const withGrant = hasDatabase
          ? await section(`${username} grants`, () => contactsWithReadGrant(username, new Date()), new Set<string>())
          : new Set<string>();
        return {
          username,
          listed: listed.has(username),
          trips: trips.length,
          tripsByVisibility,
          current: trips.find((t) => t.status === "current")?.title ?? null,
          days,
          drafts,
          contacts: contacts.length,
          guests: withGrant.size,
          credits: credits && hasDatabase ? await section(`${username} credits`, () => balanceOf(username), null) : null,
          bytes: dirBytes(userDir(username)),
        };
      },
      {
        username,
        listed: listed.has(username),
        trips: 0,
        tripsByVisibility: {},
        current: null,
        days: 0,
        drafts: 0,
        contacts: 0,
        guests: 0,
        credits: null,
        bytes: 0,
      },
    ),
  );
}

/** Free space on the filesystem the content sits on — the number that decides
 * whether any of the above matters next week. */
const disk = await section(
  "disk",
  () => {
    const fsStat = fs.statfsSync(contentRoot());
    return { free: fsStat.bavail * fsStat.bsize, total: fsStat.blocks * fsStat.bsize };
  },
  null as { free: number; total: number } | null,
);

const site = await section("site config", () => loadServerConfig().site, { name: "Fernscout", url: "" });

const total = <K extends keyof JournalRow>(key: K): number =>
  rows.reduce((sum, row) => sum + (typeof row[key] === "number" ? (row[key] as number) : 0), 0);

if (asJson) {
  console.log(JSON.stringify({ site: site.name, journals: rows, disk, problems }, null, 2));
  process.exit(0);
}

const out: string[] = [];
out.push(`${site.name} — ${rows.length} journal${rows.length === 1 ? "" : "s"}, ${total("trips")} trips, ${total("days")} days published`);
out.push("");

const drafts = total("drafts");
const summary = [`${listed.size} of ${rows.length} journals listed`];
if (hasDatabase) {
  summary.push(`${total("guests")} guests with a live grant, of ${total("contacts")} contacts`);
}
if (drafts) summary.push(`${drafts} day${drafts === 1 ? "" : "s"} still in draft`);
for (const line of summary) out.push(`  ${line}`);

if (disk) {
  const used = total("bytes");
  out.push(`  ${bytes(used)} of content, ${bytes(disk.free)} free of ${bytes(disk.total)} on disk`);
} else {
  out.push(`  ${bytes(total("bytes"))} of content`);
}
out.push("");

// One line per journal, widest name first so the columns line up without a
// table library. An instance with three journals and one with thirty both read
// the same way.
// Header and cells from one list of columns, so they cannot drift apart —
// which is exactly what a hand-written header row does the first time a column
// is added in the middle.
const width = Math.max(8, ...rows.map((r) => r.username.length));
const columns: { head: string; of: (row: JournalRow) => string }[] = [
  { head: "trips", of: (r) => String(r.trips) },
  { head: "days", of: (r) => String(r.days) },
  { head: "draft", of: (r) => String(r.drafts) },
];
if (hasDatabase) columns.push({ head: "guests", of: (r) => String(r.guests) });
if (credits && hasDatabase) columns.push({ head: "credits", of: (r) => String(r.credits ?? "—") });
columns.push({ head: "size", of: (r) => bytes(r.bytes) });

const cell = (text: string, head: string) => text.padStart(Math.max(head.length, 6));
out.push(`  ${"journal".padEnd(width)}  ${columns.map((c) => cell(c.head, c.head)).join("  ")}`);
for (const row of rows.sort((a, b) => b.days - a.days || a.username.localeCompare(b.username))) {
  out.push(`  ${row.username.padEnd(width)}  ${columns.map((c) => cell(c.of(row), c.head)).join("  ")}`);
  // Hung under the name rather than given a column: it is prose, and only some
  // journals have any.
  if (row.current) out.push(`  ${" ".repeat(width)}  on the road: ${row.current}`);
  if (!row.listed) out.push(`  ${" ".repeat(width)}  unlisted`);
}

const off = [
  !hasDatabase ? "no database on this instance — contacts, guests and credits are not counted" : "",
  hasDatabase && !credits ? "credits are switched off" : "",
].filter(Boolean);
if (off.length) out.push("", ...off.map((line) => `  ${line}`));

if (problems.length) {
  // Named, not swallowed. A section that failed and printed nothing would read
  // as "there are none of those", which is worse than the failure.
  out.push("", `  ${problems.length} part${problems.length === 1 ? "" : "s"} of this report could not be read:`);
  for (const problem of problems) out.push(`    ${problem}`);
}

console.log(out.join("\n"));
