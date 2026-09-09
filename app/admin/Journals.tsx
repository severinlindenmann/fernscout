"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { formatChf } from "@/lib/credits/pricing";
import { formatCredits } from "@/lib/credits/format";
import { Meter, Sparkline } from "./Charts";

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
  panel: ReactNode;
};

/** Below this the controls are noise: a search box over four rows is slower
 *  to use than reading the four rows. */
const CROWDED = 6;

/** How many rows stand on the page unasked. Five is about what somebody reads
 *  before scrolling, and the two questions this page is opened with — who
 *  costs the most, who is about to run out — are both answered by the top of a
 *  sorted list. The rest is one button away. */
const FIRST = 5;

export type Order = "cost" | "name" | "balance";

const ORDERS: { value: Order; label: string }[] = [
  { value: "cost", label: "Costliest" },
  { value: "name", label: "By name" },
  { value: "balance", label: "Lowest balance" },
];

/**
 * The list as the operator asked for it. Exported for the tests: it is the
 * whole of what the controls do, and it is checkable without a browser.
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
          : b.rappen - a.rappen,
    );
}

/** The two smaller facts under a name, in one place so the row and the panel
 *  cannot come to disagree about them. */
function credits(journal: JournalView): string {
  const held =
    journal.balance === null
      ? "no credits on this instance"
      : `${formatCredits(journal.balance)} credits`;
  // Two decimals since B987: a balance is hundredths of a credit, and "8.79"
  // is the number the journal's owner sees on their own page.
  return `${held} · ${formatCredits(journal.spent)} spent of ${formatCredits(journal.granted)} granted`;
}

/**
 * How full the balance is, and whether that is worth a colour — B996.
 *
 * `granted` is everything this journal has ever been given, so the fraction is
 * what is left of all of it rather than of the last purchase. A journal that
 * was never granted anything gets **no meter at all**: an empty bar there
 * would read as "spent it all" when the truth is "was never given any", and
 * those are opposite facts about the same person.
 */
function meterOf(journal: JournalView): { fraction: number; tone: "navy" | "alert" } | null {
  if (journal.balance === null || journal.granted <= 0) return null;
  return {
    fraction: journal.balance / journal.granted,
    tone: journal.balance === 0 ? "alert" : "navy",
  };
}

/**
 * The journal rows, searchable and sortable — B893, reshaped by B992.
 *
 * A hosted instance grows a journal at a time and the list never shrinks, so
 * the page that was readable at three is a scroll at thirty. Filtering happens
 * here rather than in a query string because every row is already on the page:
 * a round-trip to hide six of them would be slower.
 *
 * Three things B992 changed, each because the control was in the way of the
 * list rather than beside it:
 *
 * - **Five rows, then a button.** Thirty-five rows pushed everything else on
 *   the page below the fold; searching finds any of them, and the button shows
 *   the lot.
 * - **The sort is buttons, not a `<select>`.** A select renders its options in
 *   the operating system's own menu, floating over the page — the state you
 *   chose is a word you have to open a menu to re-read. Three buttons say
 *   which one is on without being opened.
 * - **A journal opens in a panel over the page, not a `<details>` inside the
 *   list.** Its ledger is fifty rows; expanded in place it buried whatever was
 *   underneath, and the operator's own reason for opening a journal — its
 *   purchases, its ledger, adding credits — belongs together rather than
 *   scattered between a row here and a form at the bottom of the page.
 */
export default function Journals({ rows }: { rows: JournalView[] }) {
  const [query, setQuery] = useState("");
  const [order, setOrder] = useState<Order>("cost");
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const shown = useMemo(() => pick(rows, query, order), [rows, query, order]);
  const visible = all ? shown : shown.slice(0, FIRST);
  const opened = rows.find((row) => row.username === open) ?? null;

  return (
    <>
      {rows.length >= CROWDED ? (
        <div className="mt-3 space-y-2">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Search ${rows.length} journals`}
            aria-label="Search journals"
            className="w-full rounded-lg border border-navy-200 bg-white px-3 py-2 text-navy-900"
          />
          <div role="group" aria-label="Sort journals" className="flex flex-wrap gap-2">
            {ORDERS.map((choice) => (
              <button
                key={choice.value}
                type="button"
                aria-pressed={order === choice.value}
                onClick={() => setOrder(choice.value)}
                className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${
                  order === choice.value
                    ? "border-navy-900 bg-navy-900 text-white"
                    : "border-navy-200 bg-white text-navy-700 hover:bg-cream-100"
                }`}
              >
                {choice.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-3 space-y-2">
        {shown.length === 0 ? (
          <p className="text-sm text-navy-500">No journal here is called that.</p>
        ) : null}
        {visible.map((journal) => {
          const meter = meterOf(journal);
          return (
          <button
            key={journal.username}
            type="button"
            onClick={() => setOpen(journal.username)}
            className="block w-full rounded-2xl border border-navy-200 bg-white px-4 py-3 text-left hover:border-navy-400"
          >
            {/* Name and money on one line whatever the width — an `ml-auto`
                inside a flex-wrap put the cost under the username on a
                phone, which is where it stopped being a summary. */}
            <span className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 break-words font-display font-semibold text-navy-900">
                {journal.username}
              </span>
              <span className="shrink-0 font-mono text-sm text-navy-900">
                {formatChf(journal.rappen)}
              </span>
            </span>
            {/* The shape of the journal, beside the words for it — B996.
                The line says whether anything is happening at all, which no
                total can: two journals at the same thirty-day figure look
                identical until one of them turns out to have spent it in a
                single afternoon a month ago. */}
            <span className="mt-1 flex items-center justify-between gap-3">
              <span className="min-w-0 font-mono text-xs text-navy-500">{credits(journal)}</span>
              {journal.series ? (
                <Sparkline points={journal.series} label={`${journal.username}, day by day`} />
              ) : null}
            </span>
            {meter ? <Meter fraction={meter.fraction} tone={meter.tone} /> : null}
          </button>
          );
        })}
      </div>

      {shown.length > FIRST ? (
        <button
          type="button"
          onClick={() => setAll((was) => !was)}
          className="mt-3 rounded-full border border-navy-200 bg-white px-4 py-2 text-sm font-semibold text-navy-700 hover:bg-cream-100"
        >
          {all ? `Show ${FIRST} of ${shown.length}` : `Show all ${shown.length}`}
        </button>
      ) : null}

      {opened ? <Panel journal={opened} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

/**
 * One journal, over the page.
 *
 * The panel it holds was rendered on the server with the rest of the list, so
 * opening one costs no request and shows what the page already knew. Escape
 * and the backdrop both close it; there is nothing to lose by closing, since
 * the only thing here that writes — adding credits — says what it did on the
 * row it did it from.
 */
function Panel({ journal, onClose }: { journal: JournalView; onClose: () => void }) {
  useEffect(() => {
    function key(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-navy-900/70 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={journal.username}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white shadow-xl sm:rounded-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-4 pb-3 pt-4">
          <div className="min-w-0">
            <h3 className="break-words font-display text-xl font-semibold text-navy-900">
              {journal.username}
            </h3>
            <p className="mt-0.5 font-mono text-xs text-navy-500">{credits(journal)}</p>
            <p className="mt-1 font-mono text-sm text-navy-900">
              {formatChf(journal.rappen)} in this period
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded-full p-1.5 text-navy-500 hover:bg-navy-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {journal.panel}
      </div>
    </div>
  );
}
