/**
 * What is on this instance, counted once and rendered two ways.
 *
 * `scripts/status.mts` prints it; `scripts/alert.mts` mails it (B464, B475).
 * The counting lives here rather than in either so that the mail can lay the
 * roster out as a table instead of re-parsing prose that was already formatted
 * for a terminal — which is what it did until B475, through a pipe and a
 * `<pre>`.
 *
 * **Nothing here is a new source of truth.** Every count comes from the reader
 * the site itself uses — `getTrips`, `getDays`, `listContacts`, `balanceOf` —
 * so a number in the mail is the number a page would render. Disk is walked
 * rather than tracked, for the reason `lib/api/media.ts` already gives about
 * its quota: a counter is a second truth that drifts the first time somebody
 * deletes a file by hand, on a system whose premise is that the content is a
 * folder you own.
 *
 * **It must not be able to cost the mail.** This is collected after a backup
 * that already finished; a section that throws becomes a named line in
 * `problems` and nothing propagates. `section()` is what enforces that — every
 * block goes through it.
 */
import fs from "node:fs";
import path from "node:path";

import { balanceOf, creditsEnabled } from "./credits";
import { contactsWithReadGrant } from "./grants";
import { getDays } from "./entries";
import { getTrips } from "./trips";
import { getUsernames, getUser, listedUsernames, userDir } from "./users";
import { contentRoot } from "./contentRoot";
import { listContacts } from "./contacts";
import { loadServerConfig } from "./config";
import { getDatabaseOrNull } from "./db";

export type JournalRow = {
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

export type StatusReport = {
  site: string;
  journals: JournalRow[];
  /** Whether contacts, guests and credits could be counted at all. */
  hasDatabase: boolean;
  creditsEnabled: boolean;
  listedCount: number;
  disk: { free: number; total: number } | null;
  /** Sections that could not be read, each named. Never thrown. */
  problems: string[];
};

/** Bytes, at the precision an operator reads rather than the one a disk has. */
function formatBytes(n: number): string {
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

export async function collectStatus(): Promise<StatusReport> {
  const problems: string[] = [];

  /**
   * Run one block, and never let it be the reason nothing is sent.
   *
   * A journal with a malformed `config.json`, a database that is down, a
   * permission the walk did not expect — every one of those is a line in the
   * report rather than an exception out of it. The failure is *named*: a
   * section that quietly returned nothing would read as "there are none",
   * which is the one wrong answer a status report must not give.
   */
  async function section<T>(label: string, fn: () => Promise<T> | T, fallback: T): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      problems.push(`${label}: ${(error as Error).message}`);
      return fallback;
    }
  }

  const listed = new Set(await section("listed journals", () => listedUsernames(), []));
  const usernames = await section("journals", () => getUsernames(), []);
  const credits = await section("credits", () => creditsEnabled(), false);

  /**
   * Contacts, guests and credits all live in the database, and an instance
   * without one is the ordinary case rather than a fault — the prototype tier
   * is the same app with the flags off (docs/runbook.md). Asked once, so a
   * laptop gets one sentence instead of two error lines per journal saying the
   * same thing, and so those columns can be left out rather than printed as
   * zeroes. A zero here would be a claim: "nobody is reading this journal".
   */
  const hasDatabase = await section("database", async () => (await getDatabaseOrNull()) !== null, false);

  const journals: JournalRow[] = [];
  for (const username of usernames) {
    const empty: JournalRow = {
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
    };
    journals.push(
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
            ...empty,
            trips: trips.length,
            tripsByVisibility,
            current: trips.find((t) => t.status === "current")?.title ?? null,
            days,
            drafts,
            contacts: contacts.length,
            guests: withGrant.size,
            credits:
              credits && hasDatabase
                ? await section(`${username} credits`, () => balanceOf(username), null)
                : null,
            bytes: dirBytes(userDir(username)),
          };
        },
        empty,
      ),
    );
  }

  /** Free space on the filesystem the content sits on — the number that decides
   * whether any of the above matters next week. */
  const disk = await section(
    "disk",
    () => {
      const stat = fs.statfsSync(contentRoot());
      return { free: stat.bavail * stat.bsize, total: stat.blocks * stat.bsize };
    },
    null as { free: number; total: number } | null,
  );

  const site = await section("site config", () => loadServerConfig().site.name, "Fernscout");

  journals.sort((a, b) => b.days - a.days || a.username.localeCompare(b.username));

  return {
    site,
    journals,
    hasDatabase,
    creditsEnabled: credits,
    listedCount: listed.size,
    disk,
    problems,
  };
}

/** Totals across every journal, for a numeric column. */
function statusTotal(report: StatusReport, key: "trips" | "days" | "drafts" | "contacts" | "guests" | "bytes"): number {
  return report.journals.reduce((sum, row) => sum + row[key], 0);
}

/** The headline and the two or three lines under it, shared by both renderers
 * so the mail and the terminal cannot come to disagree about the summary. */
export function statusSummary(report: StatusReport): { headline: string; lines: string[] } {
  const journals = report.journals.length;
  const headline =
    `${report.site} — ${journals} journal${journals === 1 ? "" : "s"}, ` +
    `${statusTotal(report, "trips")} trips, ${statusTotal(report, "days")} days published`;

  const lines = [`${report.listedCount} of ${journals} journals listed`];
  if (report.hasDatabase) {
    lines.push(
      `${statusTotal(report, "guests")} guests with a live grant, of ${statusTotal(report, "contacts")} contacts`,
    );
  }
  const drafts = statusTotal(report, "drafts");
  if (drafts) lines.push(`${drafts} day${drafts === 1 ? "" : "s"} still in draft`);
  lines.push(
    report.disk
      ? `${formatBytes(statusTotal(report, "bytes"))} of content, ` +
        `${formatBytes(report.disk.free)} free of ${formatBytes(report.disk.total)} on disk`
      : `${formatBytes(statusTotal(report, "bytes"))} of content`,
  );
  return { headline, lines };
}

/** Which columns this instance has anything to say about. Shared, so the table
 * in the mail and the one in the terminal have the same shape. */
export function statusColumns(report: StatusReport): { head: string; of: (row: JournalRow) => string }[] {
  const columns: { head: string; of: (row: JournalRow) => string }[] = [
    { head: "trips", of: (r) => String(r.trips) },
    { head: "days", of: (r) => String(r.days) },
    { head: "draft", of: (r) => String(r.drafts) },
  ];
  if (report.hasDatabase) columns.push({ head: "guests", of: (r) => String(r.guests) });
  if (report.creditsEnabled && report.hasDatabase) {
    columns.push({ head: "credits", of: (r) => String(r.credits ?? "—") });
  }
  columns.push({ head: "size", of: (r) => formatBytes(r.bytes) });
  return columns;
}

/** What is switched off, said once rather than as a column of zeroes. */
export function statusNotes(report: StatusReport): string[] {
  return [
    !report.hasDatabase ? "no database on this instance — contacts, guests and credits are not counted" : "",
    report.hasDatabase && !report.creditsEnabled ? "credits are switched off" : "",
  ].filter(Boolean);
}

/**
 * The plain-text rendering: what `npm run status` prints, and the text part of
 * the mail. Not a stub of the HTML one — it is what lands in a terminal mail
 * client and in a scrollback.
 */
export function statusText(report: StatusReport): string {
  const { headline, lines } = statusSummary(report);
  const out: string[] = [headline, ""];
  for (const line of lines) out.push(`  ${line}`);
  out.push("");

  // Header and cells from one list of columns, so they cannot drift apart —
  // which is what a hand-written header row does the first time a column is
  // added in the middle.
  const width = Math.max(8, ...report.journals.map((r) => r.username.length));
  const columns = statusColumns(report);
  const cell = (text: string, head: string) => text.padStart(Math.max(head.length, 6));
  out.push(`  ${"journal".padEnd(width)}  ${columns.map((c) => cell(c.head, c.head)).join("  ")}`);
  for (const row of report.journals) {
    out.push(`  ${row.username.padEnd(width)}  ${columns.map((c) => cell(c.of(row), c.head)).join("  ")}`);
    // Hung under the name rather than given a column: it is prose, and only
    // some journals have any.
    if (row.current) out.push(`  ${" ".repeat(width)}  on the road: ${row.current}`);
    if (!row.listed) out.push(`  ${" ".repeat(width)}  unlisted`);
  }

  const notes = statusNotes(report);
  if (notes.length) out.push("", ...notes.map((line) => `  ${line}`));

  if (report.problems.length) {
    // Named, not swallowed. A section that failed and printed nothing would
    // read as "there are none of those", which is worse than the failure.
    const n = report.problems.length;
    out.push("", `  ${n} part${n === 1 ? "" : "s"} of this report could not be read:`);
    for (const problem of report.problems) out.push(`    ${problem}`);
  }

  return out.join("\n");
}
