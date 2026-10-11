import { execFile } from "node:child_process";
import { scrubLog } from "./scrubLog";

/**
 * The Logs section of `/admin` (B-2995): the errors and warnings the app
 * already writes, read back out of the journald namespace the unit logs to
 * (`docs/runbook.md`, "Request logging"), 14 days.
 *
 * **Nothing is recorded for this page.** No table, no file; the lines were
 * scrubbed when written (`lib/scrubLog.ts`) and are scrubbed again here, so a
 * line from before that rule cannot leak. A source this does not know (free
 * text `console.error`) is simply absent, not guessed at.
 *
 * `parseLogEntries` and `filterLogs` are pure so a test can run them on
 * fixture lines; `readLogs` is the one place that touches journalctl.
 */

export type LogLevel = "error" | "warn";
export type LogKind = "req" | "req-error" | "client-error";

export type LogEntry = {
  /** ISO time journald stamped the line with. */
  at: string;
  level: LogLevel;
  kind: LogKind;
  /** The request id, `-` when the line has none. */
  id: string;
  /** The journal it is about, or null for an instance-wide line. */
  journal: string | null;
  /** One line, what happened. */
  title: string;
  /** The whole scrubbed entry, stack included. */
  detail: string;
  /** A 401 or 404: routine, hidden unless asked for. */
  routine: boolean;
};

export type LogResult =
  | { state: "ok"; entries: LogEntry[]; truncated: boolean }
  | { state: "unavailable"; reason: string };

export const LOG_WINDOWS = [1, 24, 168, 336] as const;
const READ_LINES = 5000;
const SLUG = /^[a-z0-9][a-z0-9_-]{0,40}$/i;

function slug(value: string | null | undefined): string | null {
  return value && SLUG.test(value) ? value : null;
}

/** One journald entry's text and time to a `LogEntry`, or null when it is not one of ours to show. */
export function parseLogEntry(message: string, at: string): LogEntry | null {
  // scrubLog turns a line break into a space, so scrub line by line to keep a stack readable.
  const text = message.split("\n").slice(0, 30).map((l) => scrubLog(l.replace(/\r/g, ""), 600)).join("\n");
  const first = text.split("\n", 1)[0];

  let m = /^\[req-error\] (\S+) (\S+) (\S+) (?:journal=(\S+) )?(.*)$/.exec(first);
  if (m) {
    return { at, level: "error", kind: "req-error", id: m[1], journal: slug(m[4]), routine: false, detail: text,
      title: `${m[2]} ${m[3]} crashed: ${m[5]}` };
  }

  m = /^\[client-error\] (\S+) (\S+) (\S+) (\S+) "(.*)"$/.exec(first);
  if (m) {
    return { at, level: "error", kind: "client-error", id: m[1], journal: slug(/^\/@([^/]+)/.exec(m[4])?.[1]), routine: false, detail: text,
      title: `${m[2] === "ios" ? "App" : "Web"} crash on ${m[4]} (${m[3]}): ${m[5]}` };
  }

  m = /^\[req\] (\S+) (\S+) (\S+) (\d{3}) (\d+)ms journal=(\S+) err=(\S+)$/.exec(first);
  if (m) {
    const status = Number(m[4]);
    if (status < 400) return null;
    const err = m[7] === "-" ? "" : ` ${m[7]}`;
    return { at, level: status >= 500 ? "error" : "warn", kind: "req", id: m[1], journal: m[6] === "-" ? null : slug(m[6]),
      routine: status === 401 || status === 404, detail: text, title: `${m[2]} ${m[3]} → ${status}${err} · ${m[5]} ms` };
  }
  return null;
}

type Raw = { MESSAGE?: unknown; __REALTIME_TIMESTAMP?: unknown };

/** `journalctl -o json` output (one object per line), newest first, to entries. */
export function parseLogEntries(output: string): LogEntry[] {
  const out: LogEntry[] = [];
  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    try {
      const raw = JSON.parse(line) as Raw;
      // journald gives a byte array when a message holds non-text bytes.
      const message = Array.isArray(raw.MESSAGE) ? Buffer.from(raw.MESSAGE as number[]).toString("utf8") : String(raw.MESSAGE ?? "");
      const micros = Number(raw.__REALTIME_TIMESTAMP);
      if (!Number.isFinite(micros)) continue;
      const entry = parseLogEntry(message, new Date(micros / 1000).toISOString());
      if (entry) out.push(entry);
    } catch {
      // not JSON: skip, never fail the page over one line
    }
  }
  return out;
}

export type LogFilter = { level: LogLevel | "all"; journal: string | "all" | "instance"; kind: LogKind | "all"; routine: boolean };

export function filterLogs(entries: LogEntry[], f: LogFilter): LogEntry[] {
  return entries.filter(
    (e) =>
      (f.level === "all" || e.level === f.level) &&
      (f.kind === "all" || e.kind === f.kind) &&
      (f.journal === "all" || (f.journal === "instance" ? e.journal === null : e.journal === f.journal)) &&
      (f.routine || !e.routine),
  );
}

type Run = (args: string[]) => Promise<{ stdout: string } | { error: string; missing?: boolean }>;

const runJournalctl: Run = (args) =>
  new Promise((resolve) => {
    execFile("journalctl", args, { timeout: 5000, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (!err) return resolve({ stdout });
      const code = (err as NodeJS.ErrnoException).code;
      resolve({ error: String(stderr || err.message).trim().slice(0, 200), missing: code === "ENOENT" });
    });
  });

/** Pre-filter in journald so a busy `[request]` stream cannot push the errors out of the 5000 lines. */
const LINES_WE_SHOW = String.raw`^\[(req-error|client-error)\] |^\[req\] \S+ \S+ \S+ [45]\d\d `;

/**
 * Read the last `hours` of the `fernscout` namespace. Fixed arguments, no
 * shell, nothing the caller typed reaches the command: `hours` is one of
 * `LOG_WINDOWS`. Where journald is missing or the service user may not read
 * the namespace, say so instead of showing an empty list that reads as "no errors".
 */
export async function readLogs(hours: number, run: Run = runJournalctl): Promise<LogResult> {
  const h = (LOG_WINDOWS as readonly number[]).includes(hours) ? hours : 24;
  const base = ["--namespace=fernscout", "-u", "fernscout", "--no-pager", "-o", "json", "-r", "-n", String(READ_LINES), `--since=-${h}h`];
  let res = await run([...base, `--grep=${LINES_WE_SHOW}`]);
  // A journalctl built without PCRE2 refuses --grep: read unfiltered then.
  if ("error" in res && !res.missing && /grep|pattern|pcre/i.test(res.error)) res = await run(base);
  if ("error" in res) {
    return { state: "unavailable", reason: res.missing ? "journalctl is not installed here (local development has no server log)." : `The server log could not be read: ${res.error || "journalctl failed"}` };
  }
  const entries = parseLogEntries(res.stdout);
  return { state: "ok", entries, truncated: res.stdout.split("\n").filter(Boolean).length >= READ_LINES };
}
