"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Mic, MicOff, Search as SearchIcon } from "lucide-react";
import MiniSearch from "minisearch";
import ConfirmPanel from "./ConfirmPanel";
import { useI18n } from "./LocaleProvider";
import { useSite } from "./SiteProvider";
import { SEARCH_OPTIONS, type SearchDoc } from "@/lib/searchOptions";

type LoadState = "loading" | "ready" | "error";

/**
 * The browser's own dictation, and nothing of ours — B890.
 *
 * Deliberately **not** `/api/helper/<user>/transcribe`: that route is the
 * owner's, it spends their credits and it hands the audio to Deepgram, none
 * of which belongs behind a search box a stranger may be typing into. The Web
 * Speech API costs nobody anything and reaches this page as text.
 *
 * It is still somebody's voice, so it is still asked for first: the browser
 * may forward what it hears to its own maker's service, which is a thing to
 * say out loud rather than to discover. The answer is remembered per browser,
 * and the microphone permission itself is the browser's own second question.
 */
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};

const CONSENT_KEY = "fernscout.voiceSearch";

function recognitionClass(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, new () => Recognition>;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Loads `/<username>/search-index.json` — rendered per request (see
 * app/[user]/search-index.json/route.ts), scoped to whoever is asking — and
 * searches it entirely in the browser with MiniSearch. No further request
 * reaches the server as the reader types: this is the "no runtime service"
 * half of M4 made visible. A signed-in reader gets a different, private
 * answer than a stranger does (B635); this component does not need to know
 * which — the index it receives already carries exactly what this reader
 * may see.
 */
export default function SearchBox() {
  const { t, formatShortDate, locale } = useI18n();
  const site = useSite();
  const [index, setIndex] = useState<MiniSearch<SearchDoc> | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [query, setQuery] = useState("");
  const [voice, setVoice] = useState<"off" | "asking" | "listening">("off");
  /** A client-only read, and `useSyncExternalStore` is how it is one: the
   *  server has no `window`, so it renders `false` (the third argument) and
   *  the browser decides for itself after hydration. Nothing here ever
   *  changes, so the subscribe callback has nothing to do. */
  const canSpeak = useSyncExternalStore(
    () => () => {},
    () => recognitionClass() !== null,
    () => false,
  );
  const recognition = useRef<Recognition | null>(null);

  // Whatever is still listening when this component goes away stops with it —
  // a microphone left open on a page nobody is on is the one bug this feature
  // could have that a person would feel.
  useEffect(() => () => recognition.current?.stop(), []);

  function listen() {
    const Recogniser = recognitionClass();
    if (!Recogniser) return;
    const r = new Recogniser();
    r.lang = locale;
    r.continuous = false;
    r.interimResults = true;
    r.onresult = (event) => {
      const last = event.results[event.results.length - 1];
      setQuery(last[0].transcript);
    };
    r.onend = () => setVoice("off");
    r.onerror = () => setVoice("off");
    recognition.current = r;
    setVoice("listening");
    r.start();
  }

  function toggleVoice() {
    if (voice === "listening") {
      recognition.current?.stop();
      setVoice("off");
      return;
    }
    if (localStorage.getItem(CONSENT_KEY) === "yes") listen();
    else setVoice("asking");
  }

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
      // Fuzzy only for a word long enough to have a typo in it. At four
      // letters a single edit reaches half the dictionary, and since B890 the
      // index carries the documentation's whole prose — which is how "alps"
      // came back with three guides under the trip it actually meant.
      fuzzy: (term) => (term.length > 5 ? 0.2 : false),
      boost: { title: 3, tags: 3, terms: 2, location: 2, tripTitle: 1.5 },
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
          className={`w-full rounded-full border border-navy-200 bg-white py-3 pl-11 text-sm text-navy-900 placeholder:text-navy-500 focus:border-navy-500 focus:outline-none disabled:opacity-60 ${
            canSpeak ? "pr-12" : "pr-4"
          }`}
        />
        {canSpeak && (
          <button
            type="button"
            onClick={toggleVoice}
            aria-label={voice === "listening" ? t("search.voiceStop") : t("search.voiceStart")}
            aria-pressed={voice === "listening"}
            className="absolute top-1/2 right-2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full text-navy-600 transition-colors hover:bg-cream-100"
          >
            {voice === "listening" ? (
              <MicOff className="h-4 w-4 text-coral-600" strokeWidth={2.2} />
            ) : (
              <Mic className="h-4 w-4" strokeWidth={2.2} />
            )}
          </button>
        )}
      </div>

      {voice === "asking" && (
        <div className="mt-3">
          <ConfirmPanel
            label={t("search.voiceStart")}
            question={t("search.voiceConsentTitle")}
            details={t("search.voiceConsentBody")}
            confirmLabel={t("search.voiceConsentAccept")}
            onConfirm={() => {
              localStorage.setItem(CONSENT_KEY, "yes");
              listen();
            }}
            onCancel={() => setVoice("off")}
          />
        </div>
      )}

      {voice === "listening" && (
        <p role="status" className="mt-2 text-xs text-navy-600">
          {t("search.voiceListening")}
        </p>
      )}

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
                    className="block px-4 py-3 transition-colors hover:bg-cream-100"
                  >
                    <p className="font-display text-base font-semibold text-navy-900">
                      {r.title as string}
                    </p>
                    {subtitle && <p className="mt-0.5 text-xs text-navy-600">{subtitle}</p>}
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
