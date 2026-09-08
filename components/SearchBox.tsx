"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import Link from "next/link";
import { Mic, MicOff, Search as SearchIcon, Sparkles } from "lucide-react";
import AgentMicIcon from "./AgentMicIcon";
import RecordButton from "./RecordButton";
import MiniSearch from "minisearch";
import BusyButton from "./BusyButton";
import ConfirmPanel from "./ConfirmPanel";
import { useI18n } from "./LocaleProvider";
import { useSite } from "./SiteProvider";
import {
  SEARCH_OPTIONS,
  SEARCH_QUERY,
  type SearchDoc,
} from "@/lib/searchOptions";

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
  onresult:
    | ((event: {
        results: ArrayLike<ArrayLike<{ transcript: string }>>;
      }) => void)
    | null;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
};

/**
 * The recogniser wants a BCP-47 tag, and a journal's locale is two letters.
 *
 * B975: `r.lang = "de"` is refused outright by a browser that will not
 * resolve a bare code — `language-not-supported`, raised the instant `start()`
 * is called, which is what "it turns straight back off" was. Anything not
 * listed is passed through as it stands rather than guessed at: a wrong region
 * is worse than none, and a browser that accepts the bare code will go on
 * accepting it.
 */
const SPEECH_TAGS: Record<string, string> = {
  en: "en-US",
  de: "de-DE",
  hu: "hu-HU",
};

const CONSENT_KEY = "fernscout.voiceSearch";

/**
 * What the agent sends back — B904. `url` is the route's own, resolved from
 * the catalogue it sent the model; nothing here trusts a model's idea of a
 * link, and this component could not tell the difference, which is exactly
 * why the resolving happens on the server.
 */
type AgentHit = {
  id: string;
  kind: string;
  title: string;
  where: string;
  url: string;
  why: string;
};

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
export default function SearchBox({
  username,
  speech,
}: {
  username?: string;
  /**
   * This instance's own transcriber, for the owner — B981.
   *
   * Present only where `transcription` is on and the reader owns the journal
   * (the page decides, on the server). When it is here, speaking is not a way
   * to fill the box: what comes back goes straight to the agent, because a
   * sentence somebody says out loud — "the day we got lost near the border" —
   * is exactly the sentence MiniSearch cannot answer and B904 can.
   *
   * When it is absent, the browser's own dictation stands: free, filling the
   * box, and useless in a browser with no speech service (B975), which is what
   * this exists to answer for the one person whose credits are at stake.
   */
  speech?: { consented: boolean; provider: string; balance: number | null };
}) {
  const { t, formatShortDate, locale } = useI18n();
  const site = useSite();
  const [index, setIndex] = useState<MiniSearch<SearchDoc> | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [query, setQuery] = useState("");
  const [voice, setVoice] = useState<"off" | "asking" | "listening">("off");
  /** What went wrong the last time the microphone was asked for — B975. The
   *  API's failures are all silent by nature, so this is the only way a
   *  person learns the difference between a blocked microphone and a browser
   *  that has no speech service at all. */
  const [voiceError, setVoiceError] = useState("");
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
  /**
   * Whether the agent button belongs on this page at all — B904.
   *
   * Read off the summary every page under `/<user>` already carries rather
   * than probed with a request: `isOwner` and `helperEnabled` are exactly the
   * two questions the route would answer, and asking it instead put a 401 in
   * the console of every signed-out reader who opened Search.
   */
  const canAsk = site.isOwner && site.helperEnabled;
  /**
   * The only thing this page ever says about money — B986.
   *
   * Not a price on the button: a search box with a tariff on it is a search
   * box people stop pressing. The one number that changes what happens is a
   * balance of nothing, and then the microphone is switched off rather than
   * spending a press on a refusal. `null` means credits are off on this
   * instance, which is not a shortage.
   */
  const outOfCredits = speech?.balance === 0;
  const [agent, setAgent] = useState<"idle" | "busy" | "error">("idle");
  const [hits, setHits] = useState<AgentHit[] | null>(null);
  const [asked, setAsked] = useState("");

  async function askAgent(sentence?: string) {
    const said = (sentence ?? query).trim();
    if (said === "") return;
    setAgent("busy");
    setHits(null);
    setAsked(said);
    try {
      const res = await fetch(`/api/helper/${site.username}/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ said }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { hits?: AgentHit[] };
      setHits(data.hits ?? []);
      setAgent("idle");
    } catch {
      setAgent("error");
    }
  }

  // Whatever is still listening when this component goes away stops with it —
  // a microphone left open on a page nobody is on is the one bug this feature
  // could have that a person would feel.
  useEffect(() => () => recognition.current?.stop(), []);

  function listen() {
    const Recogniser = recognitionClass();
    if (!Recogniser) return;
    const r = new Recogniser();
    r.lang = SPEECH_TAGS[locale] ?? locale;
    // A pause is a pause. With `continuous` off the session ends at the first
    // silence, so somebody drawing breath before speaking was told nothing
    // and left with the microphone shut — B975.
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (event) => {
      const last = event.results[event.results.length - 1];
      setQuery(last[0].transcript);
    };
    r.onend = () => setVoice("off");
    r.onerror = (event) => {
      setVoice("off");
      const code = event.error ?? "";
      // `aborted` is this page's own `stop()` — the person pressed the button
      // again, and telling them what they just did is noise.
      if (code === "aborted") return;
      if (code === "not-allowed" || code === "service-not-allowed") {
        setVoiceError(t("search.voiceBlocked"));
      } else if (code === "no-speech") {
        setVoiceError(t("search.voiceNoSpeech"));
      } else if (code === "network" || code === "language-not-supported") {
        setVoiceError(t("search.voiceNoService"));
      } else {
        setVoiceError(t("search.voiceFailed", { code: code || "?" }));
      }
    };
    recognition.current = r;
    setVoiceError("");
    setVoice("listening");
    try {
      r.start();
    } catch {
      // `start()` on a recogniser that is already running throws rather than
      // raising `onerror`, and there is nothing to report: it is already on.
      setVoice("listening");
    }
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
    return index.search(trimmed, SEARCH_QUERY);
  }, [index, trimmed]);

  return (
    <div>
      <label htmlFor="search-input" className="sr-only">
        {t("search.title")}
      </label>
      {/* Two boxes, and the nesting carries the fix — B1004.
          The **inner** one is the field, and it holds only the things that may
          be centred against it: the magnifying glass, the input, and the
          microphone button. `RecordButton` also renders an elapsed line, an
          error and — on the first press — a whole consent panel; mounted in
          here they grew the box, and the glass, centred with `top-1/2`, slid
          down into the middle of it.
          The **outer** one is where those go, in ordinary flow underneath.
          The button is pinned to it with a fixed offset rather than `top-1/2`
          for the same reason: an offset from the top does not move when
          something appears below. */}
      <div className="relative">
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
            (canSpeak && !speech) || speech ? "pr-12" : "pr-4"
          }`}
        />
        {canSpeak && !speech && (
          <button
            type="button"
            onClick={toggleVoice}
            aria-label={
              voice === "listening"
                ? t("search.voiceStop")
                : t("search.voiceStart")
            }
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
        {speech && username && (
          <RecordButton
            username={username}
            consented={speech.consented}
            provider={speech.provider}
            compact
            // 44px of target, no frame: the field is the frame, and a second
            // ring inside it reads as a control bolted on. `right-1.5` rather
            // than `right-1` so the circle is inset from the field's own
            // rounded edge by the same amount the search icon is on the left.
            compactClassName="absolute right-1.5 top-px h-11 w-11 hover:bg-cream-100"
            // A toggle, never a hold: press to start, press to stop. Moving
            // the pointer off a 44px target is what a person does when they
            // start speaking, and it was ending the recording.
            hold={false}
            icon={<AgentMicIcon className="h-5 w-5" />}
            // The page's own language, and no question about it — B986.
            language={locale}
            disabled={agent === "busy" || outOfCredits}
            onText={(said) => {
              // Into the box *and* away, with no second press: what was said
              // out loud was the question, not a draft of it.
              setQuery(said);
              void askAgent(said);
            }}
          />
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

      {outOfCredits && (
        <p className="mt-2 text-sm text-navy-700">
          {t("search.voiceNoCredits")}
        </p>
      )}

      {voiceError && (
        <p role="status" className="mt-2 text-sm text-coral-600">
          {voiceError}
        </p>
      )}

      {canAsk && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <BusyButton
            busy={agent === "busy"}
            type="button"
            onClick={() => void askAgent()}
            disabled={trimmed.length === 0}
            className="inline-flex min-h-11 items-center gap-2 rounded-full border border-navy-300 px-4 text-sm font-semibold text-navy-800 transition-colors hover:bg-cream-100 disabled:opacity-50"
          >
            <Sparkles className="h-4 w-4" strokeWidth={2.2} />
            {agent === "busy" ? t("search.agentBusy") : t("search.agentAsk")}
          </BusyButton>
          <p className="text-xs text-navy-600">{t("search.agentHint")}</p>
        </div>
      )}

      {agent === "error" && (
        <p role="status" className="mt-2 text-sm text-coral-600">
          {t("search.agentError")}
        </p>
      )}

      {hits && agent !== "busy" && (
        <div className="mt-4">
          <h2 className="font-display text-sm font-semibold text-navy-900">
            {t("search.agentHeading")}
          </h2>
          {hits.length === 0 ? (
            <p className="mt-2 text-sm text-navy-600">
              {t("search.agentEmpty", { query: asked })}
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-navy-200 overflow-hidden rounded-2xl border border-navy-200 bg-white">
              {hits.map((hit) => (
                <li key={hit.id}>
                  <Link
                    href={hit.url}
                    className="block px-4 py-3 transition-colors hover:bg-cream-100"
                  >
                    <p className="font-display text-base font-semibold text-navy-900">
                      {hit.title}
                    </p>
                    <p className="mt-0.5 text-xs text-navy-600">
                      {[hit.where, hit.why].filter(Boolean).join(" · ")}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="mt-6">
        {state === "error" && (
          <p className="text-sm text-navy-600">{t("search.error")}</p>
        )}

        {state === "ready" && trimmed.length === 0 && (
          <p className="text-sm text-navy-600">{t("search.noQuery")}</p>
        )}

        {state === "ready" && trimmed.length > 0 && results.length === 0 && (
          <p className="text-sm text-navy-600">
            {t("search.noResults", { query: trimmed })}
          </p>
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
                    {subtitle && (
                      <p className="mt-0.5 text-xs text-navy-600">{subtitle}</p>
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
