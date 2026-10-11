import { filterLogs, LOG_WINDOWS, readLogs, type LogEntry, type LogFilter, type LogKind } from "@/lib/adminLogs";

/**
 * The Logs section (B-2995): errors and warnings out of the server log, per
 * journal. A plain GET form, so a filtered view is a link and no client script
 * is needed.
 *
 * **It reads nothing until asked.** The page renders every section on each
 * load and the log is a `journalctl` call, so the panel opens on a button and
 * only a submitted form (`?logs=1`) reads it.
 */

const CARD = "rounded-3xl border border-line-quiet bg-surface-raised p-5";
const FIELD = "rounded-full border border-line-quiet bg-surface-raised px-3 py-1.5 text-sm text-ink-strong";
const KINDS: Record<LogKind | "all", string> = {
  all: "All sources",
  req: "API call",
  "req-error": "API crash",
  "client-error": "Browser or app crash",
};
const WINDOW_LABEL: Record<number, string> = { 1: "1 hour", 24: "24 hours", 168: "7 days", 336: "14 days" };

export type LogsQuery = Partial<Record<"logs" | "level" | "journal" | "kind" | "window" | "routine", string | string[]>>;

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

function stamp(at: string): string {
  return `${at.slice(5, 10)} ${at.slice(11, 19)}`;
}

export default async function Logs({ query, days }: { query: LogsQuery; days: number }) {
  const hours = LOG_WINDOWS.find((w) => String(w) === one(query.window)) ?? 24;
  const level = one(query.level) === "warn" ? "warn" : one(query.level) === "all" ? "all" : "error";
  const kind = (Object.keys(KINDS).includes(one(query.kind)) ? one(query.kind) : "all") as LogKind | "all";
  const routine = one(query.routine) === "1";
  const asked = one(query.logs) === "1";
  const result = asked ? await readLogs(hours) : null;

  // A journal filter can only name a journal the window actually shows (or "instance").
  const seen = result?.state === "ok" ? [...new Set(result.entries.map((e) => e.journal).filter((j): j is string => !!j))].sort() : [];
  const wanted = one(query.journal);
  const journal = wanted === "instance" || seen.includes(wanted) ? wanted : "all";
  const filter: LogFilter = { level, journal, kind, routine };
  const shown: LogEntry[] = result?.state === "ok" ? filterLogs(result.entries, filter).slice(0, 200) : [];
  const inWindow = result?.state === "ok" ? filterLogs(result.entries, { ...filter, level: "all" }) : [];
  const errors = inWindow.filter((e) => e.level === "error").length;

  return (
    <section className={`${CARD} mt-6`}>
      <form action="/admin#logs" method="get" className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <input type="hidden" name="logs" value="1" />
        <input type="hidden" name="days" value={days} />
        <label className="flex items-center gap-2 text-sm text-ink-body">
          Level
          <select name="level" defaultValue={level} className={FIELD}>
            <option value="error">Errors</option>
            <option value="warn">Warnings</option>
            <option value="all">Both</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-ink-body">
          Journal
          <select name="journal" defaultValue={journal} className={FIELD}>
            <option value="all">All journals</option>
            <option value="instance">Instance-wide</option>
            {seen.map((j) => (
              <option key={j} value={j}>
                {j}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-ink-body">
          Source
          <select name="kind" defaultValue={kind} className={FIELD}>
            {Object.entries(KINDS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-ink-body">
          Window
          <select name="window" defaultValue={String(hours)} className={FIELD}>
            {LOG_WINDOWS.map((w) => (
              <option key={w} value={w}>
                {WINDOW_LABEL[w]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-ink-body">
          <input type="checkbox" name="routine" value="1" defaultChecked={routine} />
          Include 401 and 404
        </label>
        <button type="submit" className="rounded-full bg-ink-strong px-4 py-1.5 text-sm font-semibold text-surface-base">
          {asked ? "Show" : "Read the log"}
        </button>
      </form>

      {!result ? (
        <p className="mt-4 text-sm text-ink-body">
          The log is read when you ask, from the server&apos;s own journal (kept 14 days). Nothing is stored for this page.
        </p>
      ) : result.state === "unavailable" ? (
        <p className="mt-4 rounded-2xl bg-coral-50 p-3.5 text-sm text-coral-600 [overflow-wrap:anywhere]">{result.reason}</p>
      ) : (
        <>
          <p className="mt-4 text-sm text-ink-body">
            {errors} errors and {inWindow.length - errors} warnings in the last {WINDOW_LABEL[hours]}
            {journal === "all" ? "" : ` for ${journal === "instance" ? "the instance" : journal}`}.
            {result.truncated ? " The newest 5000 matching lines were read; older ones in this window are not shown." : ""}
          </p>
          {shown.length === 0 ? (
            <p className="mt-3 rounded-2xl bg-green-100 p-3.5 text-sm text-green-700">Nothing matches these filters.</p>
          ) : (
            <ol className="mt-3">
              {shown.map((e, i) => (
                <li key={`${e.at}-${e.id}-${i}`} className="border-t border-line-faint py-2">
                  <details>
                    <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="shrink-0 font-mono text-xs text-ink-secondary">{stamp(e.at)}</span>
                      <span
                        className={`shrink-0 text-xs font-bold uppercase tracking-wide ${e.level === "error" ? "text-coral-600" : "text-yellow-900"}`}
                      >
                        {e.level === "error" ? "Error" : "Warn"}
                      </span>
                      <span className="min-w-0 flex-1 text-sm text-ink-strong [overflow-wrap:anywhere]">{e.title}</span>
                      <span className="shrink-0 rounded-full bg-surface-neutral px-2.5 py-0.5 text-xs text-ink-body">
                        {e.journal ?? "instance"}
                      </span>
                    </summary>
                    <pre className="mt-2 overflow-x-auto rounded-xl bg-surface-neutral p-3 font-mono text-xs text-ink-body">
                      {e.detail}
                      {"\n"}
                      {`${e.kind} · ${e.id} · ${e.at}Z`}
                    </pre>
                  </details>
                </li>
              ))}
            </ol>
          )}
          <p className="mt-3 text-xs text-ink-secondary">
            Times are UTC. Showing up to 200, newest first. The request id ties one failure&apos;s lines together.
          </p>
        </>
      )}
    </section>
  );
}
