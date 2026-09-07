"use client";

import { useMemo, useState, type ReactNode } from "react";
import { formatChf } from "@/lib/credits/pricing";

/** One row, with its opened panel already rendered on the server. */
export type JournalView = {
  username: string;
  rappen: number;
  balance: number | null;
  spent: number;
  granted: number;
  panel: ReactNode;
};

/** Below this the controls are noise: a search box over four rows is slower
 *  to use than reading the four rows. */
const CROWDED = 6;

export type Order = "cost" | "name" | "balance";

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

/**
 * The journal rows, searchable and sortable — B893.
 *
 * A hosted instance grows a journal at a time and the list never shrinks, so
 * the page that was readable at three is a scroll at thirty. Filtering happens
 * here rather than in a query string because every row is already on the page:
 * a round-trip to hide six of them would be slower and would lose whichever
 * `<details>` the operator had open.
 *
 * Sorted by cost first, because "who is spending my money" is the question
 * this page is opened with; by name for finding somebody, and by balance for
 * spotting who is about to run out.
 */
export default function Journals({ rows }: { rows: JournalView[] }) {
  const [query, setQuery] = useState("");
  const [order, setOrder] = useState<Order>("cost");

  const shown = useMemo(() => pick(rows, query, order), [rows, query, order]);

  return (
    <>
      {rows.length >= CROWDED ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Search ${rows.length} journals`}
            aria-label="Search journals"
            className="min-w-0 flex-1 basis-48 rounded-lg border border-navy-200 bg-white px-3 py-2 text-navy-900"
          />
          <select
            value={order}
            onChange={(event) => setOrder(event.target.value as Order)}
            aria-label="Sort journals"
            className="min-w-0 flex-1 basis-36 rounded-lg border border-navy-200 bg-white px-3 py-2 text-navy-900"
          >
            <option value="cost">Costliest first</option>
            <option value="name">By name</option>
            <option value="balance">Lowest balance</option>
          </select>
        </div>
      ) : null}

      <div className="mt-3 space-y-2">
        {shown.length === 0 ? (
          <p className="text-sm text-navy-500">No journal here is called that.</p>
        ) : null}
        {shown.map((journal) => (
          <details key={journal.username} className="rounded-2xl border border-navy-200 bg-white">
            {/* Name and money on one line whatever the width — an `ml-auto`
                inside a flex-wrap put the cost under the username on a
                phone, which is where it stopped being a summary. The two
                smaller facts wrap underneath, where wrapping is harmless. */}
            <summary className="cursor-pointer list-none px-4 py-3">
              <span className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 break-words font-display font-semibold text-navy-900">
                  {journal.username}
                </span>
                <span className="shrink-0 font-mono text-sm text-navy-900">
                  {formatChf(journal.rappen)}
                </span>
              </span>
              <span className="mt-0.5 block font-mono text-xs text-navy-500">
                {journal.balance === null
                  ? "no credits on this instance"
                  : `${journal.balance} credits`}
                {` · ${journal.spent} spent of ${journal.granted} granted`}
              </span>
            </summary>
            {journal.panel}
          </details>
        ))}
      </div>
    </>
  );
}
