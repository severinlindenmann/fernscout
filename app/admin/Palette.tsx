"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";

/**
 * Jump anywhere on `/admin` by typing — ⌘K or Ctrl+K, or the search field in
 * the header.
 *
 * It only moves: every item is a place on this page (a section, or one
 * journal's panel), so choosing one sets the hash and nothing else. Nothing
 * here acts on anything, which is why it needs no confirmation and why it can
 * be opened from anywhere without asking the server.
 */

export type PaletteItem = { label: string; hint: string; hash: string };

/** Shown before anything is typed, and the cap on what a query returns. */
const SHOWN = 8;

/** Name contains every typed word, in any order, ignoring case. Exported for
 *  the tests. */
export function matchItems(items: PaletteItem[], query: string): PaletteItem[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return items.slice(0, SHOWN);
  return items
    .filter((item) => {
      const hay = `${item.label} ${item.hint}`.toLowerCase();
      return words.every((word) => hay.includes(word));
    })
    .slice(0, SHOWN);
}

export default function Palette({
  open,
  onOpen,
  items,
  onPick,
}: {
  open: boolean;
  onOpen: (open: boolean) => void;
  items: PaletteItem[];
  onPick: (item: PaletteItem) => void;
}) {
  const [query, setQuery] = useState("");
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const found = useMemo(() => matchItems(items, query), [items, query]);

  useEffect(() => {
    function key(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        onOpen(true);
      }
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onOpen]);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  if (!open) return null;

  function close() {
    setQuery("");
    setAt(0);
    onOpen(false);
  }

  function choose(item: PaletteItem | undefined) {
    if (!item) return;
    onPick(item);
    close();
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center bg-overlay-strong/60 px-4 pt-[12vh]"
      onClick={close}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Jump to"
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-line-quiet bg-surface-raised shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <label className="flex items-center gap-3 border-b border-line-faint px-4">
          <Search aria-hidden className="h-4 w-4 shrink-0 text-ink-secondary" />
          <span className="sr-only">Jump to</span>
          <input
            ref={input}
            type="search"
            value={query}
            placeholder="A journal, a section…"
            onChange={(event) => {
              setQuery(event.target.value);
              setAt(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") close();
              else if (event.key === "ArrowDown") {
                event.preventDefault();
                setAt((was) => Math.min(was + 1, found.length - 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setAt((was) => Math.max(was - 1, 0));
              } else if (event.key === "Enter") {
                event.preventDefault();
                choose(found[at]);
              }
            }}
            className="min-h-14 flex-1 bg-transparent text-base text-ink-strong outline-none"
          />
        </label>
        {found.length === 0 ? (
          <p className="px-4 py-5 text-sm text-ink-secondary">Nothing here is called that.</p>
        ) : (
          <ul className="max-h-80 overflow-y-auto p-1.5">
            {found.map((item, index) => (
              <li key={`${item.hint}:${item.hash}:${item.label}`}>
                <button
                  type="button"
                  onMouseEnter={() => setAt(index)}
                  onClick={() => choose(item)}
                  className={`flex min-h-11 w-full items-center justify-between gap-3 rounded-xl px-3 text-left ${
                    index === at ? "bg-surface-subtle" : ""
                  }`}
                >
                  <span className="min-w-0 break-words font-semibold text-ink-strong">{item.label}</span>
                  <span className="shrink-0 font-mono text-xs text-ink-secondary">{item.hint}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
