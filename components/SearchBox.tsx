"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Search as SearchIcon } from "lucide-react";
import MiniSearch from "minisearch";
import { useI18n } from "./LocaleProvider";
import { useSite } from "./SiteProvider";
import {
  SEARCH_OPTIONS,
  SEARCH_QUERY,
  type SearchDoc,
} from "@/lib/searchOptions";

type LoadState = "loading" | "ready" | "error";

/**
 * Loads `/<username>/search-index.json` — rendered per request (see
 * app/[user]/search-index.json/route.ts), scoped to whoever is asking — and
 * searches it entirely in the browser with MiniSearch. No further request
 * reaches the server as the reader types: this is the "no runtime service"
 * half of M4 made visible. A signed-in reader gets a different, private
 * answer than a stranger does (B635); this component does not need to know
 * which — the index it receives already carries exactly what this reader
 * may see.
 *
 * Plain type-to-search, and nothing else — B2310. What used to sit beside
 * this box (an agent to ask, an agent microphone, the browser's own
 * dictation) is gone on the owner's own word: "just normal type search."
 */
export default function SearchBox() {
  const { t, formatShortDate } = useI18n();
  const site = useSite();
  const [index, setIndex] = useState<MiniSearch<SearchDoc> | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch(`/${site.username}/search-index.json`)
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
        return res.text();
      })
      .then((json) => {
        if (cancelled) return;
        setIndex(MiniSearch.loadJSON<SearchDoc>(json, SEARCH_OPTIONS));
        setState("ready");
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [site.username]);

  const trimmed = query.trim();
  const results = useMemo(() => {
    if (!index || trimmed.length === 0) return [];
    return index.search(trimmed, SEARCH_QUERY);
  }, [index, trimmed]);

  return (
    <div>
      <label htmlFor="search-input" className="sr-only">
        {t("search.title")}
      </label>
      <div className="relative">
        <SearchIcon
          className="pointer-events-none absolute top-1/2 left-4 h-4 w-4 -translate-y-1/2 text-ink-muted"
          strokeWidth={2.2}
        />
        <input
          id="search-input"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("search.placeholder")}
          disabled={state === "error"}
          autoFocus
          autoComplete="off"
          className="w-full rounded-full border border-line-quiet bg-surface-raised py-3 pr-4 pl-11 text-sm text-ink-strong placeholder:text-ink-muted focus:border-line-prominent focus:outline-none disabled:opacity-60"
        />
      </div>

      <div className="mt-6">
        {state === "error" && (
          <p className="text-sm text-ink-secondary">{t("search.error")}</p>
        )}

        {state === "ready" && trimmed.length === 0 && (
          <p className="text-sm text-ink-secondary">{t("search.noQuery")}</p>
        )}

        {state === "ready" && trimmed.length > 0 && results.length === 0 && (
          <p className="text-sm text-ink-secondary">
            {t("search.noResults", { query: trimmed })}
          </p>
        )}

        {results.length > 0 && (
          <ul className="divide-y divide-line-quiet overflow-hidden rounded-2xl border border-line-quiet bg-surface-raised">
            {results.map((r) => {
              // Only a day has a date *and* a place; everything else would
              // be misread as one if it borrowed that line. A destination
              // (Gallery, Costs, the account page — B823) names its trip if
              // it has one, a trip names when it was, and a documentation
              // page says that is what it is (B890).
              const tripTitle = r.tripTitle as string;
              const subtitle =
                r.kind === "day"
                  ? `${r.location as string} · ${formatShortDate(r.date as string)} · ${tripTitle}`
                  : r.kind === "trip"
                    ? formatShortDate(r.date as string)
                    : r.kind === "doc"
                      ? t("search.docsKind")
                      : tripTitle;
              return (
                <li key={r.id as string}>
                  <Link
                    href={r.url as string}
                    className="block px-4 py-3 transition-colors hover:bg-surface-subtle"
                  >
                    <p className="font-display text-base font-semibold text-ink-strong">
                      {r.title as string}
                    </p>
                    {subtitle && (
                      <p className="mt-0.5 text-xs text-ink-secondary">{subtitle}</p>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
