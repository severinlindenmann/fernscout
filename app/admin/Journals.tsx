"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Download, ExternalLink, X } from "lucide-react";
import { formatChf } from "@/lib/creditsFormat";
import { formatCredits } from "@/lib/creditsFormat";
import { Meter, Sparkline } from "./Charts";
import { goTo, useHash } from "./Shell";

/** One row, with its opened panel already rendered on the server. */
export type JournalView = {
  username: string;
  rappen: number;
  balance: number | null;
  spent: number;
  granted: number;
  /** This journal's metered spend, one entry per day of the window — B996.
   *  Absent for a journal that spent nothing, which draws no line at all. */
  series?: number[];
  /** When a day file was last touched, ISO — B1181. Null for a journal with
   *  no day at all, which is a different row from one that has gone quiet. */
  lastWroteAt: string | null;
  /** What the journal takes up, in words, and how full that is — B1181.
   *
   *  Formatted on the server rather than here: `formatBytes` lives in
   *  `lib/storageQuota`, which reaches the database, and importing it into a
   *  client component pulls `better-sqlite3` into the browser bundle. */
  disk: string;
  /** How full, 0 to 1, or null where the instance sets no ceiling. */
  full: number | null;
  /** The shape of the journal, from the five-minute status walk. Absent when
   *  the walk has not seen it, which is not the same as zero. */
  trips?: number;
  days?: number;
  drafts?: number;
  readers?: number;
  panel: ReactNode;
};

export type Order = "recent" | "cost" | "name" | "balance" | "disk";

/** `recent` is first and is the default since B1181: most journals spend
 *  nothing, so a list sorted by cost puts three real rows above a tail of
 *  zeroes in whatever order they happen to be in. */
const ORDERS: { value: Order; label: string }[] = [
  { value: "recent", label: "Last wrote" },
  { value: "cost", label: "Costliest" },
  { value: "name", label: "By name" },
  { value: "balance", label: "Lowest balance" },
  { value: "disk", label: "Fullest disk" },
];

/**
 * The list as the operator asked for it. Exported for the tests: it is the
 * whole of what the search and sort do, and it is checkable without a browser.
 */
export function pick<T extends JournalView>(rows: T[], query: string, order: Order): T[] {
  const needle = query.trim().toLowerCase();
  return rows
    .filter((row) => row.username.toLowerCase().includes(needle))
    .sort((a, b) =>
      order === "name"
        ? a.username.localeCompare(b.username)
        : order === "balance"
          ? (a.balance ?? 0) - (b.balance ?? 0)
          : order === "disk"
            ? (b.full ?? 0) - (a.full ?? 0)
            : order === "recent"
              ? // Newest first, and a journal that has never written anything
                // sorts to the bottom rather than to the top of an ascending
                // string comparison against "".
                (b.lastWroteAt ?? "").localeCompare(a.lastWroteAt ?? "")
              : b.rappen - a.rappen,
    );
}

/** How long a journal may go untouched before it is "quiet" rather than being
 *  written, and then before it is dormant. A fortnight and a season: the same
 *  fortnight `STILL_WRITING_DAYS` uses for the funnel. */
const QUIET_DAYS = 14;
const DORMANT_DAYS = 90;

type State = { word: "writing" | "quiet" | "dormant" | "never started"; dot: string; pill: string };

/**
 * Alive, quiet, dormant, or never started — B1181.
 *
 * The fact that makes every other column mean something. A journal at CHF 0.00
 * that was written to yesterday and one at CHF 0.00 that nobody has opened
 * since the spring are the same row without it, and they are opposite facts.
 *
 * Exported for the tests, which is also where the boundaries are pinned.
 */
export function stateOf(lastWroteAt: string | null, now = Date.now()): State {
  if (!lastWroteAt) {
    return {
      word: "never started",
      dot: "bg-surface-raised border border-line-strong",
      pill: "border border-line-strong text-ink-secondary",
    };
  }
  const days = (now - Date.parse(lastWroteAt)) / 86_400_000;
  if (days <= QUIET_DAYS) return { word: "writing", dot: "bg-green-700", pill: "bg-green-100 text-green-700" };
  if (days <= DORMANT_DAYS) return { word: "quiet", dot: "bg-yellow-600", pill: "bg-yellow-100 text-yellow-900" };
  return { word: "dormant", dot: "bg-action-strong", pill: "bg-surface-neutral-strong text-ink-secondary" };
}

/** When, in the coarsest words that are still true. An exact timestamp on a
 *  row is a thing to decode; "3 weeks ago" is the answer to the question. */
export function whenWords(lastWroteAt: string | null, now = Date.now()): string {
  if (!lastWroteAt) return "never wrote a day";
  const days = Math.floor((now - Date.parse(lastWroteAt)) / 86_400_000);
  if (days <= 0) return "wrote today";
  if (days === 1) return "wrote yesterday";
  if (days < 14) return `wrote ${days} days ago`;
  if (days < 60) return `wrote ${Math.round(days / 7)} weeks ago`;
  return `wrote ${Math.round(days / 30)} months ago`;
}

export type Filter = "all" | "writing" | "quiet" | "dormant" | "never" | "look";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "writing", label: "Writing" },
  { value: "quiet", label: "Gone quiet" },
  { value: "dormant", label: "Dormant" },
  { value: "never", label: "Never started" },
  { value: "look", label: "Needs a look" },
];

/**
 * Which rows a filter keeps. Exported for the tests.
 *
 * "Needs a look" is the two things the attention band also raises about a
 * journal, drawn from the same numbers the row shows: a disk past 85% of its
 * ceiling, and a balance under a tenth of everything it was ever granted. A
 * journal that was never granted anything is not low — it was never given any.
 */
export function matches(row: JournalView, filter: Filter, now = Date.now()): boolean {
  if (filter === "all") return true;
  if (filter === "look") {
    const low = row.balance !== null && row.granted > 0 && row.balance / row.granted < 0.1;
    return low || (row.full ?? 0) > 0.85;
  }
  const word = stateOf(row.lastWroteAt, now).word;
  return filter === "never" ? word === "never started" : word === filter;
}

/** One cell, quoted when it has to be — RFC 4180. */
function cell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * The rows as CSV, exactly as the table shows them — every column a figure
 * the page already had, nothing fetched for the export. Exported for the tests.
 */
export function toCsv(rows: JournalView[], days: number, now = Date.now()): string {
  const head = [
    "journal",
    "state",
    "last_wrote_at",
    "trips",
    "days",
    "readers",
    "disk",
    "balance_credits",
    "spent_credits",
    "granted_credits",
    `metered_chf_${days}d`,
  ];
  const lines = rows.map((row) =>
    [
      row.username,
      stateOf(row.lastWroteAt, now).word,
      row.lastWroteAt,
      row.trips,
      row.days,
      row.readers,
      row.disk,
      row.balance === null ? null : formatCredits(row.balance),
      formatCredits(row.spent),
      formatCredits(row.granted),
      (row.rappen / 100).toFixed(2),
    ]
      .map(cell)
      .join(","),
  );
  return [head.join(","), ...lines].join("\n") + "\n";
}

/** The two smaller facts under a name, in one place so the row and the panel
 *  cannot come to disagree about them. */
function credits(journal: JournalView): string {
  const held =
    journal.balance === null ? "no credits on this instance" : `${formatCredits(journal.balance)} credits`;
  return `${held} · ${formatCredits(journal.spent)} spent of ${formatCredits(journal.granted)} granted`;
}

/**
 * The journals, as a table on a desktop and a list on a phone, with one
 * journal's panel beside it — the panel was rendered on the server with the
 * rest, so opening one costs no request.
 *
 * **The open journal is in the URL** (`#journals/<name>`), so the attention
 * band, the palette and a bookmark can all open one directly. On a desktop the
 * panel stands beside the table; on a phone the same element is a sheet over
 * the page, because a column beside a 390px list is a column nobody can read.
 */
export default function Journals({ rows, days }: { rows: JournalView[]; days: number }) {
  const hash = useHash();
  const [query, setQuery] = useState("");
  const [order, setOrder] = useState<Order>("recent");
  const [filter, setFilter] = useState<Filter>("all");

  const open = hash.startsWith("journals/") ? hash.slice("journals/".length) : null;
  const opened = rows.find((row) => row.username === open) ?? null;
  const counts = useMemo(
    () => Object.fromEntries(FILTERS.map((one) => [one.value, rows.filter((row) => matches(row, one.value)).length])),
    [rows],
  );
  const shown = useMemo(
    () => pick(rows, query, order).filter((row) => matches(row, filter)),
    [rows, query, order, filter],
  );

  function download() {
    const blob = new Blob([toCsv(shown, days)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `journals-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const header = (value: Order, label: string, align = "text-left") => (
    <button
      type="button"
      onClick={() => setOrder(value)}
      aria-pressed={order === value}
      className={`min-h-10 w-full px-3 text-xs font-semibold uppercase tracking-wide ${align} ${
        order === value ? "text-ink-strong" : "text-ink-secondary"
      }`}
    >
      {label}
      {order === value ? " ↓" : ""}
    </button>
  );

  return (
    <div className="mt-6 lg:grid lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start lg:gap-5">
      <section className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Search ${rows.length} journals`}
            aria-label="Search journals"
            className="min-h-10 w-full rounded-xl border border-line-quiet bg-surface-raised px-3 text-ink-strong sm:w-56"
          />
          <div role="group" aria-label="Filter journals" className="flex flex-wrap gap-1.5">
            {FILTERS.map((one) => (
              <button
                key={one.value}
                type="button"
                aria-pressed={filter === one.value}
                onClick={() => setFilter(one.value)}
                className={`min-h-10 rounded-full border px-3 text-sm font-semibold ${
                  filter === one.value
                    ? "border-action-strong bg-action-strong text-on-action"
                    : "border-line-quiet bg-surface-raised text-ink-body hover:bg-surface-subtle"
                }`}
              >
                {one.label} <span className="font-mono text-xs">{counts[one.value]}</span>
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={download}
            disabled={shown.length === 0}
            className="flex min-h-10 items-center gap-2 rounded-xl border border-line-quiet bg-surface-raised px-3 text-sm font-semibold text-ink-strong hover:bg-surface-subtle disabled:opacity-50 sm:ml-auto"
          >
            <Download aria-hidden className="h-4 w-4" />
            Export CSV
          </button>
        </div>

        <div role="group" aria-label="Sort journals" className="mt-3 flex flex-wrap gap-1.5 md:hidden">
          {ORDERS.map((choice) => (
            <button
              key={choice.value}
              type="button"
              aria-pressed={order === choice.value}
              onClick={() => setOrder(choice.value)}
              className={`min-h-9 rounded-full border px-3 text-sm font-semibold ${
                order === choice.value
                  ? "border-action-strong bg-surface-subtle text-ink-strong"
                  : "border-line-quiet bg-surface-raised text-ink-body"
              }`}
            >
              {choice.label}
            </button>
          ))}
        </div>

        <div className="mt-3 overflow-hidden rounded-3xl border border-line-quiet bg-surface-raised">
          <div className="hidden grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_6rem_10rem] border-b border-line-quiet bg-surface-neutral md:grid">
            {header("name", "Journal")}
            {header("recent", "Last wrote")}
            {header("disk", "Disk")}
            {header("balance", "Balance", "text-right")}
            {header("cost", `Spend · ${days}d`, "text-right")}
          </div>
          {shown.length === 0 ? (
            <p className="px-4 py-5 text-sm text-ink-secondary">No journal here matches that.</p>
          ) : (
            <ul>
              {shown.map((journal) => {
                const state = stateOf(journal.lastWroteAt);
                const on = journal.username === open;
                return (
                  <li key={journal.username} className="border-t border-line-faint first:border-t-0">
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => goTo(`journals/${journal.username}`, false)}
                      className={`grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 px-4 py-3 text-left md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_6rem_10rem] md:items-center md:px-0 md:py-2.5 ${
                        on ? "bg-surface-subtle" : "hover:bg-surface-neutral"
                      }`}
                    >
                      <span className="min-w-0 md:px-3">
                        <span className="flex items-center gap-2">
                          <span aria-hidden className={`inline-block h-2 w-2 shrink-0 rounded-full ${state.dot}`} />
                          <span className="break-words font-semibold text-ink-strong">{journal.username}</span>
                        </span>
                        <span className="mt-0.5 block text-xs text-ink-secondary">
                          {journal.trips ?? "?"} trips · {journal.days ?? "?"} days · {journal.readers ?? "?"} readers
                        </span>
                      </span>
                      <span className="text-right font-mono text-sm text-ink-strong md:order-last md:px-3">
                        <span className="flex items-center justify-end gap-2">
                          {journal.series ? (
                            <span className="hidden sm:inline">
                              <Sparkline points={journal.series} label={`${journal.username}, day by day`} />
                            </span>
                          ) : null}
                          {journal.rappen === 0 ? "—" : formatChf(journal.rappen)}
                        </span>
                      </span>
                      <span className="md:px-3">
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${state.pill}`}
                        >
                          {whenWords(journal.lastWroteAt).replace(/^wrote /, "").replace("never wrote a day", "never")}
                        </span>
                      </span>
                      <span className="col-span-2 md:col-span-1 md:px-3">
                        <span
                          className={`block font-mono text-xs ${(journal.full ?? 0) > 0.85 ? "text-coral-600" : "text-ink-body"}`}
                        >
                          {journal.disk}
                        </span>
                        {journal.full !== null ? (
                          <Meter fraction={journal.full} tone={journal.full > 0.85 ? "alert" : "navy"} />
                        ) : null}
                      </span>
                      <span
                        className={`hidden text-right font-mono text-sm md:block md:px-3 ${
                          journal.balance !== null && journal.granted > 0 && journal.balance / journal.granted < 0.1
                            ? "text-coral-600"
                            : "text-ink-strong"
                        }`}
                      >
                        {journal.balance === null ? "—" : formatCredits(journal.balance)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="border-t border-line-faint px-4 py-3 text-sm text-ink-body">
            Showing {shown.length} of {rows.length}. Last wrote is the day file&rsquo;s own timestamp — the
            morning after a restore drill every journal reads as freshly written.
          </p>
        </div>
      </section>

      {opened ? (
        <Panel journal={opened} days={days} onClose={() => goTo("journals", false)} />
      ) : (
        <aside className="hidden rounded-3xl border border-dashed border-line-strong p-6 text-sm text-ink-body lg:sticky lg:top-6 lg:block">
          Pick a journal to see its disk, what its credits went on, its purchases and its conversations — and to
          grant credits or write to its owner.
        </aside>
      )}
    </div>
  );
}

/**
 * One journal: a sheet over the page on a phone, a column beside the table on
 * a desktop. Escape and the backdrop close it on a phone; on a desktop there is
 * no backdrop, and the close button is the way out.
 */
function Panel({ journal, days, onClose }: { journal: JournalView; days: number; onClose: () => void }) {
  useEffect(() => {
    function key(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);

  const state = stateOf(journal.lastWroteAt);
  const stats: [string, number | undefined][] = [
    ["Trips", journal.trips],
    ["Days", journal.days],
    ["Drafts", journal.drafts],
    ["Readers", journal.readers],
  ];

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-overlay-strong/70 backdrop-blur-sm sm:items-center sm:p-4 lg:static lg:z-auto lg:block lg:bg-transparent lg:p-0 lg:backdrop-blur-none"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label={journal.username}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-line-quiet bg-surface-raised pb-4 shadow-xl sm:rounded-3xl lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:max-w-none lg:shadow-none"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-b border-surface-muted bg-surface-subtle px-4 pb-4 pt-4">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <h2 className="break-words font-display text-2xl font-semibold text-ink-strong">
                {journal.username}
              </h2>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-body">
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${state.pill}`}>{state.word}</span>
                {whenWords(journal.lastWroteAt)}
              </p>
            </div>
            <a
              href={`/${journal.username}`}
              className="flex min-h-10 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-ink-strong underline"
            >
              Open
              <ExternalLink aria-hidden className="h-3.5 w-3.5" />
            </a>
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="flex h-10 w-10 items-center justify-center rounded-full text-ink-body hover:bg-surface-muted"
            >
              <X aria-hidden className="h-5 w-5" />
            </button>
          </div>
          <div className="mt-3 grid grid-cols-4 gap-2">
            {stats.map(([label, value]) => (
              <div key={label} className="rounded-xl bg-surface-raised px-2.5 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-secondary">{label}</p>
                <p className="font-display text-lg font-semibold text-ink-strong">{value ?? "—"}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 font-mono text-xs text-ink-body">{credits(journal)}</p>
          <p className="mt-0.5 font-mono text-sm text-ink-strong">
            {formatChf(journal.rappen)} metered in {days} days
          </p>
        </div>
        {journal.panel}
      </div>
    </div>
  );
}
