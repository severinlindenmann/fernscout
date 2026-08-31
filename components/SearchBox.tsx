"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Search as SearchIcon } from "lucide-react";
import MiniSearch from "minisearch";
import { useI18n } from "./LocaleProvider";
import { useSite } from "./SiteProvider";
import { SEARCH_OPTIONS, type SearchDoc } from "@/lib/searchOptions";

type LoadState = "loading" | "ready" | "error";

/**
 * Loads `/<username>/search-index.json` — a static asset built once at
 * `next build` (see app/[user]/search-index.json/route.ts) — and searches it
 * entirely in the browser with MiniSearch. No request ever reaches the
 * server after the initial fetch: this is the "no runtime service" half of
 * M4 made visible.
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
    return index.search(trimmed, {
      prefix: true,
      fuzzy: 0.2,
      boost: { title: 3, location: 2, tripTitle: 1.5 },
    });
  }, [index, trimmed]);

  return (
    <div>
      <label htmlFor="search-input" className="sr-only">
        {t("search.title")}
      </label>
      <div className="relative">
        <SearchIcon
          className="pointer-events-none absolute top-1/2 left-4 h-4 w-4 -translate-y-1/2 text-navy-500"
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
          className="w-full rounded-full border border-navy-200 bg-white py-3 pr-4 pl-11 text-sm text-navy-900 placeholder:text-navy-500 focus:border-navy-500 focus:outline-none disabled:opacity-60"
        />
      </div>

      <div className="mt-6">
        {state === "error" && <p className="text-sm text-navy-600">{t("search.error")}</p>}

        {state === "ready" && trimmed.length === 0 && (
          <p className="text-sm text-navy-600">{t("search.noQuery")}</p>
        )}

        {state === "ready" && trimmed.length > 0 && results.length === 0 && (
          <p className="text-sm text-navy-600">{t("search.noResults", { query: trimmed })}</p>
        )}

        {results.length > 0 && (
          <ul className="divide-y divide-navy-200 overflow-hidden rounded-2xl border border-navy-200 bg-white">
            {results.map((r) => (
              <li key={r.id as string}>
                <Link
                  href={r.url as string}
                  className="block px-4 py-3 transition-colors hover:bg-cream-100"
                >
                  <p className="font-display text-base font-semibold text-navy-900">
                    {r.title as string}
                  </p>
                  <p className="mt-0.5 text-xs text-navy-600">
                    {r.location as string} · {formatShortDate(r.date as string)} ·{" "}
                    {r.tripTitle as string}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
