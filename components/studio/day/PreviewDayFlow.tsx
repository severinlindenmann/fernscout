"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import ConfirmPanel from "@/components/ConfirmPanel";
import BusyButton from "@/components/BusyButton";
import SpeakTray from "@/components/studio/day/SpeakTray";
import type { SpeechLanguage } from "@/lib/helper/speech";
import { useI18n } from "@/components/LocaleProvider";
import { useStudioBar } from "@/components/studio/StudioBar";
import { useOnline } from "@/components/studio/useOnline";
import PublishedDay from "@/components/studio/day/PublishedDay";
import TellWho, { tellCounts, type TellProps } from "@/components/studio/day/TellWho";
import { journalPath } from "@/lib/journalPath";
import { NO_PROSE } from "@/lib/helper/draft";
import { missingConsentScopes, type ConsentScopes } from "@/lib/studio/featureConsent";
import { messageFact, publishAudienceLabel, readersFact } from "@/lib/studio/publishAudience";
import { addAllAiTags, matchingUsedBeforeTags, mergeTags, toggleTag, type TagChip } from "@/lib/studio/tagsMerge";
import { readLanguageAnswer, saveLanguageAnswer, type LanguageAnswer } from "@/lib/studio/languageAnswer";
import { dayLanguageFor, offerLocalesFor } from "@/lib/studio/dayLanguage";
import { initialSuggestionState, pickTitle, applyCompose, undoCompose, type SuggestionState } from "@/lib/studio/suggestionState";
import { hashInputs, readComposeCache, writeComposeCache } from "@/lib/studio/composeCache";
import { wordDiff } from "@/lib/studio/wordDiff";
import type { PublishRow } from "@/lib/studio/publishDay";
import type { TranslationKey } from "@/lib/i18n";

type Photo = { src: string; type: "image" | "video"; caption?: string };
type Entry = {
  slug: string;
  date: string;
  time?: string;
  title: string;
  content: string;
  location?: string;
  tags?: string[];
  visibility?: "" | "guest" | "private";
  gallery: Photo[];
  /** B2700 — absent means the journal's own `defaultLocale`. */
  language?: string;
};

/** `mode: "compose"`'s own response (B2688/B2689) — a per-sentence source so
 *  the review can show "where this came from" instead of asking the owner
 *  to trust a black box. `sources[].kind` is the same `owner`/`measured`/
 *  `seen` vocabulary the day pack itself uses. */
type ComposeSource = { id: string; kind: "owner" | "measured" | "seen" };
type ComposeTitle = { text: string; kind: "label" | "quote" | "pair" };
type ComposeVariant = { titles: ComposeTitle[]; text: string; sentences: { text: string; sources: ComposeSource[] }[] };
type ComposeMissing = { question: string; about: string };
type ComposeResult = {
  language: string;
  close: ComposeVariant | null;
  story: ComposeVariant | null;
  tags: string[];
  missing: ComposeMissing[];
};
type ComposeStatus = "idle" | "consenting" | "working" | "ready" | "error" | "nothing";
const MAX_COMPOSE_ANSWERS = 3;

const PRIMARY = "min-h-11 flex-1 rounded-full bg-yellow-400 px-4 text-base font-semibold text-yellow-950 disabled:opacity-50";

function ownWords(entry: Entry | null): string {
  const text = entry?.content ?? "";
  return text.trim() === NO_PROSE ? "" : text;
}
function words(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

/**
 * "Preview" — B2677. Every draft part of one day, stacked, as readers will
 * see it: ✦ Suggest (nothing applied until tapped), tags, languages, who
 * reads and who is told, and one primary button that names who it publishes
 * for and does the whole day in B2674's single call. Replaces the old
 * "Check your day" (`DayCheck.tsx`, removed) and the publish screen's
 * left-blank list — this is the one place the owner answers for a day
 * before it goes live.
 */
export default function PreviewDayFlow({
  username,
  tripId,
  tripTitle,
  chosen,
  also,
  blank,
  readers,
  tell,
  usedBeforeTags,
  otherLocales,
  defaultLocale,
  helperEnabled,
  consent,
  speech,
}: {
  username: string;
  tripId: string;
  tripTitle: string;
  chosen: PublishRow;
  also: PublishRow[];
  blank: string[];
  readers: string[] | null;
  tell: TellProps & { choice: { groups: string[] | null; mail: boolean } | null };
  usedBeforeTags: string[];
  /** The journal's own other languages (`user.locales` minus `defaultLocale`) — empty, no Languages row. */
  otherLocales: string[];
  defaultLocale: string;
  helperEnabled: boolean;
  consent: { words: boolean; photos: boolean };
  /** The one microphone the "missing" questions' answer field offers — null
   *  with `transcription` off, same shape `AddDayFlow` takes. */
  speech: { consented: boolean; provider: string; defaultLanguage?: SpeechLanguage } | null;
}) {
  const { t, tn, formatLongDate, languageName, locale } = useI18n();
  const online = useOnline();
  const user = encodeURIComponent(username);
  const rows = [chosen, ...also];

  const [entries, setEntries] = useState<(Entry | null)[]>(rows.map(() => null));
  const [suggestionState, setSuggestionState] = useState<SuggestionState[]>(rows.map(() => initialSuggestionState()));
  const [aiTags, setAiTags] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [tagInput, setTagInput] = useState("");
  const seededTags = useRef(false);

  // Compose (B2689) — the main part only (index 0); a multi-part day's
  // other parts keep their own words with no suggestion UI, the same
  // simplification F1 names as acceptable when the parts UI makes a
  // lazy-per-part call awkward. One call per visit: `composeStatus` starts
  // `idle`, the mount effect below either reads a cache hit, auto-composes
  // (consent already given) or waits for "✦ Suggest a version".
  const [composeStatus, setComposeStatus] = useState<ComposeStatus>("idle");
  const [composeResult, setComposeResult] = useState<ComposeResult | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeTab, setComposeTab] = useState<"close" | "story">("close");
  const [composeShowSources, setComposeShowSources] = useState(false);
  const [composeAnswers, setComposeAnswers] = useState<string[]>([]);
  const [composeAnswering, setComposeAnswering] = useState<number | null>(null);
  const [composeAnswerDraft, setComposeAnswerDraft] = useState("");
  const [composeConsenting, setComposeConsenting] = useState(false);
  // Which outcome, if any, has already been counted for the current
  // compose result — B2693 — so a re-render or a second "Keep mine" tap
  // never double-posts the same count.
  const composeOutcomeSent = useRef(false);
  // "Use this" puts the variant text into the part, editable, undo
  // available (the ticket's own words) — the main part's own editable copy
  // of whichever variant is applied, seeded from `composeResult` the
  // moment it is applied and compared back against it at save time to tell
  // "kept" from "edited" (B2693).
  const [appliedText, setAppliedText] = useState("");

  // B2700 — the main part's own language: what is already saved on the day,
  // else what this visit's own compose detected (not yet saved), else the
  // journal's `defaultLocale` — the same fallback order `LocaleProvider`
  // reads a published day with. `otherLocales` (a prop, `user.locales` minus
  // `defaultLocale`) is reconstructed back to the journal's whole locale
  // list and re-filtered against the day's own language, so a day written
  // in a non-default language is offered every OTHER language the journal
  // has, defaultLocale included, not "every language but the journal's own".
  const dayLanguage = dayLanguageFor(entries[0]?.language, composeResult?.language, defaultLocale);
  const offerLocales = offerLocalesFor(dayLanguage, defaultLocale, otherLocales);


  // Languages (B2677 item 4) — one remembered answer per trip, applied to
  // every other locale this journal has. `null` until the owner picks (or
  // the remembered answer is read on mount).
  const [langAnswer, setLangAnswer] = useState<LanguageAnswer | null>(() => readLanguageAnswer(username, tripId));
  // B2685 — index-aligned with `rows`/`entries`, like `ideas` and
  // `suggestionState` above: each part keeps its own translations, since a
  // multi-part day's parts are different days' words, never one flat map.
  const [langDrafts, setLangDrafts] = useState<Record<string, { title: string; content: string }>[]>(rows.map(() => ({})));
  const [translating, setTranslating] = useState(false);
  const [translateConsenting, setTranslateConsenting] = useState(false);

  // Readers / Message — "Change" (B2677 item 5).
  const [changing, setChanging] = useState(false);
  const [visibility, setVisibility] = useState<"" | "guest" | "private">(chosen.audience === "private" ? "private" : chosen.audience === "guest" ? "guest" : "");
  const known = new Set([...(tell.groups.map((g) => g.id)), "none"]);
  const [tellGroups, setTellGroups] = useState<string[] | null>(() => {
    const remembered = tell.choice?.groups ?? null;
    if (remembered === null || tell.groups.length === 0) return null;
    return remembered.filter((key) => known.has(key));
  });
  const [tellMail, setTellMail] = useState<boolean>(tell.choice?.mail ?? false);
  const counts = tellCounts(tell, tellGroups, tellMail);

  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string>();
  const [published, setPublished] = useState<{ told: { app: number; mail: number }; slug: string } | null>(null);

  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      const read: (Entry | null)[] = [];
      for (const row of rows) {
        const response = await fetch(`/api/helper/${user}/day?trip=${encodeURIComponent(row.tripId)}&slug=${encodeURIComponent(row.slug)}`).catch(() => null);
        const json = (await response?.json().catch(() => null)) as { preview?: { day?: { entries?: Entry[] } } } | null;
        read.push(json?.preview?.day?.entries?.find((e) => e.slug === row.slug) ?? null);
      }
      setEntries(read);
      if (!seededTags.current) {
        seededTags.current = true;
        const place = read[0]?.location;
        const already = read.flatMap((e) => e?.tags ?? []);
        setSelectedTags(new Set([...(place ? [place.toLowerCase()] : []), ...already.map((tg) => tg.toLowerCase())]));
        if (read[0]?.visibility !== undefined) setVisibility(read[0]!.visibility!);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  async function post(path: string, body: unknown) {
    // no-refresh: write-day and describe-photos only answer with suggestions; nothing on the day changes.
    const response = await fetch(`/api/helper/${user}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    const json = (await response?.json().catch(() => null)) as Record<string, unknown> | null;
    return { ok: !!response?.ok && !!json?.ok, json, status: response?.status ?? 0 };
  }

  // The consent this visit knows about: the server's answer at load, plus
  // every scope agreed to since, so a second Suggest/Translate never asks again.
  const [consentNow, setConsentNow] = useState<ConsentScopes>({ ...consent, speech: false });
  async function agree(scope: keyof ConsentScopes) {
    // no-refresh: the consent this page needs is held in consentNow right below.
    const res = await fetch(`/api/helper/${user}/consent`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scope }) }).catch(() => null);
    if (res?.ok) setConsentNow((prev) => ({ ...prev, [scope]: true }));
  }

  /**
   * ✦ Compose (B2689, replacing B2677's four blind calls) — one call for the
   * main part: a grounded `close` and `story` text, titles and tags
   * together, and up to 3 follow-up questions. Nothing is applied here; the
   * owner reads the band and taps "Read it", then "Use this" or "Keep
   * mine".
   *
   * F2 — the owner's raw words stay the source. `compose` always rebuilds
   * its pack from the day's own stored content server-side
   * (`buildDayContext`), so re-composing after a "Use this" + save would
   * otherwise build on the *AI's* text, not the owner's. This file keeps
   * the client-side half of that guarantee: `entries[0]`'s content is read
   * once, before any "Use this", and `ownWords(entries[0])` — never the
   * applied compose text — is what feeds the cache hash and what a
   * re-"Suggest" after undo starts from, for the length of this visit. A
   * server-side owner-only words field (so the guarantee survives a save
   * and a reopen) was judged a larger content-model change than this
   * ticket's budget; see the final report for the gap this leaves.
   */
  const composeKey = { username, tripId: chosen.tripId, slug: chosen.slug };
  function composeHash(answers: string[]): string {
    const entry = entries[0];
    return hashInputs(ownWords(entry), entry?.gallery.map((p) => p.src) ?? [], answers);
  }

  /** Applied by a fresh compose and by a cache hit alike, so the two paths
   *  can never drift apart — a cache hit that skipped this once left tags
   *  unapplied and the band's "ready" state out of sync with the rest of
   *  the page (caught in browser testing). */
  function applyComposeResult(result: ComposeResult) {
    setComposeResult(result);
    composeOutcomeSent.current = false;
    // C2 — Story first when there is material, Close otherwise (and when
    // Story is null the tabs below show Close alone).
    setComposeTab(result.story ? "story" : "close");
    if (result.tags.length > 0) {
      setAiTags(result.tags);
      // "Tags from compose preselected" — merged into the existing
      // selection the same way the place tag is already seeded.
      setSelectedTags((prev) => new Set([...prev, ...result.tags]));
    }
    setComposeStatus("ready");
  }

  async function runCompose(answers: string[]) {
    const entry = entries[0];
    if (!entry) return;
    setComposeStatus("working");
    const r = await post("day/write-day", { trip: chosen.tripId, slug: chosen.slug, mode: "compose", answers });
    if (!r.ok || !r.json) {
      // 400 no_notes or 422 compose_rejected: nothing the assistant could
      // write without inventing — say so, rather than a silent retry button
      // that would spend again for the same answer (prod, 2 Oct).
      setComposeStatus(r.status === 400 || r.status === 422 ? "nothing" : "error");
      return;
    }
    const result = r.json as unknown as ComposeResult;
    writeComposeCache(composeKey, composeHash(answers), result);
    applyComposeResult(result);
  }

  function onComposeSuggestTap() {
    if (!helperEnabled) return;
    if (missingConsentScopes("compose", consentNow).length > 0) {
      setComposeConsenting(true);
      return;
    }
    void runCompose(composeAnswers);
  }

  async function confirmComposeConsent() {
    for (const scope of missingConsentScopes("compose", consentNow)) await agree(scope);
    setComposeConsenting(false);
    // Granting consent here changes `consentNow.words`, which is also the
    // auto-start effect's own dependency — mark it started first so that
    // effect does not fire a second, duplicate compose call right behind
    // this one.
    composeAutoStarted.current = true;
    void runCompose(composeAnswers);
  }

  // F1 — compose starts on its own once Preview opens, when consent is
  // already given, caching by a hash of the inputs so a reopen with nothing
  // changed fires no call.
  const composeAutoStarted = useRef(false);
  useEffect(() => {
    const entry = entries[0];
    if (!entry || !helperEnabled || composeAutoStarted.current) return;
    if (missingConsentScopes("compose", consentNow).length > 0) return;
    // Only a day with words starts on its own: a photos-only day may have
    // too few descriptions to tell, and an automatic call there is spent
    // for nothing (prod, 2 Oct).
    if (words(ownWords(entry)) === 0) return;
    composeAutoStarted.current = true;
    void (async () => {
      const hash = composeHash(composeAnswers);
      const cached = readComposeCache<ComposeResult>(composeKey, hash);
      if (cached) {
        // Yield once so this effect never sets state synchronously on its
        // own render pass — the same reason the entries-loading effect
        // above is an async IIFE too.
        await Promise.resolve();
        applyComposeResult(cached);
        return;
      }
      await runCompose(composeAnswers);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries[0], helperEnabled, consentNow.words]);

  function recordComposeOutcome(outcome: "kept" | "edited" | "discarded", composedText: string, savedText: string) {
    if (composeOutcomeSent.current) return;
    composeOutcomeSent.current = true;
    const variant = suggestionState[0]?.composeApplied ?? "none";
    void post("day/compose-outcome", { variant, outcome, composedText, savedText }).catch(() => {});
  }

  function applyComposeVariant(variant: "close" | "story") {
    if (!composeResult) return;
    setAppliedText(composeResult[variant]!.text);
    setSuggestionState((prev) => prev.map((v, i) => (i === 0 ? applyCompose(v, variant) : v)));
  }

  function keepMineInstead() {
    const applied = suggestionState[0]?.composeApplied;
    setSuggestionState((prev) => prev.map((v, i) => (i === 0 ? undoCompose(v) : v)));
    if (composeResult) {
      const activeText = (applied && composeResult[applied]?.text) || composeResult[composeTab]?.text || "";
      recordComposeOutcome("discarded", activeText, "");
    }
  }

  async function addComposeAnswer() {
    const answer = composeAnswerDraft.trim();
    if (!answer || composeAnswers.length >= MAX_COMPOSE_ANSWERS) return;
    const next = [...composeAnswers, answer];
    setComposeAnswers(next);
    setComposeAnswerDraft("");
    setComposeAnswering(null);
    await runCompose(next);
  }

  const place = entries[0]?.location ?? null;
  // B2677, bug 12 — only a "used before" tag that actually matches this
  // day's own words or place is offered, never the journal's whole history.
  const dayWords = entries.map((e) => `${e?.title ?? ""} ${e?.content ?? ""}`).join(" ");
  const matchedUsedBeforeTags = matchingUsedBeforeTags(usedBeforeTags, dayWords, place);
  const tagChips: TagChip[] = mergeTags(place, matchedUsedBeforeTags, aiTags, selectedTags);

  // Tags, translations and this day's visibility are held here and written
  // once, in order, by `persistChoices` right before publishing — never one
  // PATCH per tap, which raced its own If-Match and lost the second write.
  function saveTags(next: Set<string>) {
    setSelectedTags(next);
  }

/** B2685/B2689 — a part's own final title/words: the picked title (or the
   *  date, "keep the date" being the default) and, for the main part only,
   *  the applied compose text — the same choices `persistChoices` below
   *  already reads off `suggestionState`/`composeResult` before it writes
   *  a part. */
  function finalTitle(i: number): string {
    return suggestionState[i]?.titleChoice || entries[i]?.title || "";
  }
  function finalContent(i: number): string {
    const ss = suggestionState[i];
    const applied = i === 0 ? ss?.composeApplied : null;
    return applied ? appliedText : ownWords(entries[i]);
  }

  // Languages — ✦ Translate / Write it myself / "<language> is fine". B2677,
  // bug 9 — one row for every other locale together, not one per locale.
  // B2685 — every part of the day, not only the first: one call per part per
  // language (a later part, or a later language, still runs even if an
  // earlier one fails), each from that part's own final text.
  async function runTranslate() {
    if (missingConsentScopes("translate", consentNow).length > 0) {
      setTranslateConsenting(true);
      return;
    }
    setTranslating(true);
    for (let i = 0; i < rows.length; i++) {
      const content = finalContent(i);
      if (!content.trim()) continue; // write-day refuses an empty translate.
      const title = finalTitle(i);
      for (const toLocale of offerLocales) {
        const r = await post("day/write-day", { trip: rows[i].tripId, slug: rows[i].slug, mode: "translate", to: toLocale, title, content, date: rows[i].date });
        if (r.ok) {
          const part = i;
          setLangDrafts((prev) => prev.map((d, at) => (at === part ? { ...d, [toLocale]: { title: String(r.json?.title ?? ""), content: String(r.json?.content ?? "") } } : d)));
        }
      }
    }
    setTranslating(false);
    setLangAnswer("translate");
    saveLanguageAnswer(username, tripId, "translate");
  }

  async function confirmTranslateConsent() {
    await agree("words");
    setTranslateConsenting(false);
    void runTranslate();
  }

  function saveTranslations() {
    // Held in `langDrafts`; written by `persistChoices`.
  }

  function declineLanguage() {
    setLangAnswer("default");
    saveLanguageAnswer(username, tripId, "default");
  }

  // Readers / Message "Change" — visibility + who is told.
  function saveChange() {
    // Held in `visibility`; written by `persistChoices`.
    setChanging(false);
  }

  /**
   * Everything the owner chose on this page, written before the publish:
   * 1. each part's accepted suggestions (tidied words, the picked title,
   *    captions) through the helper's own day PATCH — a new title can rename
   *    the slug, so the slugs the publish then names come from its answers;
   * 2. the main day's tags, translations and visibility in ONE cookie PATCH,
   *    against an ETag read fresh after step 1.
   * Returns the slugs to publish, or null when a write failed (nothing is
   * published then, and the owner sees why).
   */
  async function persistChoices(): Promise<string[] | null> {
    const slugs = rows.map((row) => row.slug);
    for (let i = 0; i < rows.length; i++) {
      const entry = entries[i];
      const ss = suggestionState[i];
      const applied = i === 0 ? ss.composeApplied : null;
      const body: Record<string, unknown> = { trip: rows[i].tripId, slug: rows[i].slug };
      if (applied && composeResult) {
        const composedText = composeResult[applied]!.text;
        const savedText = appliedText;
        body.content = savedText;
        // B2700 — the language compose detected itself writing in, so a day
        // composed in a different language than the journal's own is read
        // back correctly (the fallback notice, the translate offer) rather
        // than assumed to be the journal's `defaultLocale`.
        body.language = composeResult.language;
        // B2698 — the owner's own words, from before this compose round
        // touched `content`; the server only keeps the first one it is
        // ever sent (`applyEditToDay`), so a later "Use this" never
        // overwrites it with the AI's own text.
        body.ownWords = ownWords(entry);
        // B2693 — counted once, right before the write it describes: kept
        // (saved exactly as composed) or edited (anything else, with a
        // word-level edit distance computed server-side from both texts
        // and stored as a number only — see `compose-outcome/route.ts`).
        recordComposeOutcome(composedText.trim() === savedText.trim() ? "kept" : "edited", composedText, savedText);
      }
      if (ss.titleChoice && ss.titleChoice !== entry?.title) body.title = ss.titleChoice;
      if (Object.keys(body).length === 2) continue;
      // no-refresh: these are persisted right before the publish call below, which itself never refreshes either (B2677, bug 14) — the page navigates away or shows PublishedDay next, never stays here stale.
      const response = await fetch(`/api/helper/${user}/day`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }).catch(() => null);
      if (!response?.ok) return null;
      const json = (await response.json().catch(() => null)) as { draft?: { slug?: string } } | null;
      slugs[i] = json?.draft?.slug ?? rows[i].slug;
    }
    // B2685 — each part's own translations, through the v2 day route (the
    // helper PATCH just above has no `translations` field — only `title`,
    // `content`, `captions`, `photoVisibility` and declines); each against
    // its own fresh ETag, so a multi-part day lands every part's words in
    // its own document rather than all under the main day's.
    for (let i = 0; i < rows.length; i++) {
      const drafts = langDrafts[i];
      if (!drafts || Object.keys(drafts).length === 0) continue;
      const partUrl = `/api/web/${user}/trips/${encodeURIComponent(rows[i].tripId)}/days/${encodeURIComponent(slugs[i])}`;
      const partHead = await fetch(partUrl).then((r) => (r.ok ? r.json() : null)).catch(() => null) as { etag?: string } | null;
      const partResponse = await fetch(partUrl, {
        method: "PATCH",
        headers: { "content-type": "application/json", ...(partHead?.etag ? { "if-match": partHead.etag } : {}) },
        body: JSON.stringify({ translations: drafts }),
      }).catch(() => null);
      if (!partResponse?.ok) return null;
    }

    const main = slugs[0];
    const patch: Record<string, unknown> = {};
    if (selectedTags.size > 0) patch.tags = [...selectedTags];
    if (visibility) patch.visibility = visibility;
    else if (blank.includes("visibility")) patch.declined = { visibility: "shown to everyone the trip lets in" };
    if (Object.keys(patch).length > 0) {
      const dayUrl = `/api/web/${user}/trips/${encodeURIComponent(chosen.tripId)}/days/${encodeURIComponent(main)}`;
      const head = await fetch(dayUrl).then((r) => (r.ok ? r.json() : null)).catch(() => null) as { etag?: string } | null;
      // no-refresh: these are persisted right before the publish call below, which itself never refreshes either (B2677, bug 14) — the page navigates away or shows PublishedDay next, never stays here stale.
      const response = await fetch(dayUrl, {
        method: "PATCH",
        headers: { "content-type": "application/json", ...(head?.etag ? { "if-match": head.etag } : {}) },
        body: JSON.stringify(patch),
      }).catch(() => null);
      if (!response?.ok) return null;
    }
    return slugs;
  }

  const audienceLabel = publishAudienceLabel(chosen.audience, readers?.length ?? null);
  const publishLabel = audienceLabel.kind === "everyone" ? t("studio.preview.publishEveryone") : tn("studio.preview.publishReaders", audienceLabel.count, { count: String(audienceLabel.count) });

  async function doPublish() {
    setPublishing(true);
    setPublishError(undefined);
    const slugs = await persistChoices();
    if (!slugs) {
      setPublishing(false);
      setPublishError(t("studio.publish.failed"));
      return;
    }
    const url = `/api/web/${user}/trips/${encodeURIComponent(chosen.tripId)}/days/${encodeURIComponent(slugs[0])}/publish`;
    const body = JSON.stringify({
      ...(slugs.length > 1 ? { parts: slugs.slice(1) } : {}),
      tell: { groups: tellGroups, mail: tellMail && counts.mailable > 0 },
    });
    // no-refresh: B2677 bug 14 — PublishedDay below needs this draft still readable; a refresh races it and loses. Next navigation re-reads fresh.
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body }).catch(() => null);
    const json = (await response?.json().catch(() => null)) as { told?: { app: number; mail: number } } | null;
    setPublishing(false);
    if (response?.ok) {
      setPublished({ told: json?.told ?? { app: 0, mail: 0 }, slug: slugs[0] });
      return;
    }
    setPublishError(response?.status === 422 ? t("studio.publish.incomplete") : t("studio.publish.failed"));
  }

  useStudioBar(published ? null : (
    <BusyButton busy={publishing} type="button" className={PRIMARY} disabled={!online} onClick={() => void doPublish()}>
      {publishLabel}
    </BusyButton>
  ), { replace: true, desktop: true });

  // B2683, bug 1 — `StudioPage`'s own h1 is server-rendered once as
  // "Preview" and never re-renders on this purely client-side state change
  // (no navigation happens on publish, by design — see the publish
  // handler's own "no-refresh" notes). `StudioPage` itself takes no hooks on
  // purpose, so it cannot read `published`; this is the one place that
  // knows both.
  useEffect(() => {
    if (!published) return;
    const h1 = document.getElementById("studio-page-title");
    // The status card is the headline now (B2765); the h1 stays for screen readers only.
    if (h1) {
      h1.textContent = t("studio.published.pageTitle");
      h1.classList.add("sr-only");
    }
  }, [published, t]);

  if (published) {
    const nobodyTold = published.told.app === 0 && published.told.mail === 0;
    const readerLine =
      audienceLabel.kind === "readers"
        ? audienceLabel.count === 0
          ? t("studio.published.toldNoReaders")
          : nobodyTold
          ? tn("studio.published.toldNobody", audienceLabel.count, { count: String(audienceLabel.count) })
          : tn("studio.published.told", audienceLabel.count, { count: String(audienceLabel.count), app: String(published.told.app), mail: String(published.told.mail) })
        : nobodyTold
          ? t("studio.published.toldEveryoneNobody")
          : t("studio.published.toldEveryone", { app: String(published.told.app), mail: String(published.told.mail) });
    return (
      <PublishedDay
        username={username}
        tripId={chosen.tripId}
        slug={published.slug}
        title={suggestionState[0]?.titleChoice || entries[0]?.title || formatLongDate(chosen.date)}
        readerLine={readerLine}
        thumb={entries[0]?.gallery.length ? `/api/web/${user}/trips/${encodeURIComponent(chosen.tripId)}/days/${encodeURIComponent(published.slug)}/story?look=photo` : null}
      />
    );
  }

  const nameOf = entries[0]?.title || formatLongDate(chosen.date);
  const backHref = `${journalPath(username)}/studio/day/publish`;

  // B2677, bug 11 — the two fact rows that replace the old reader box.
  const readers1 = readersFact(chosen.audience, readers?.length ?? null);
  const readerNames = readers && readers.length > 0 && readers.length <= 8 ? new Intl.ListFormat(locale, { type: "conjunction" }).format(readers) : null;
  const message1 = messageFact({ pushOn: tell.pushOn, mailOn: tell.mailOn, hasReaders: tell.people.length > 0 || tell.anonymousPush > 0, explicitChoice: tellGroups !== null, push: counts.push, mail: tellMail ? counts.mailable : 0 });

  return (
    <div className="mt-2">
      <Link href={backHref} className="inline-block text-sm font-semibold text-ink-body underline underline-offset-2">
        {t("studio.publish.backToDrafts")}
      </Link>
      <h2 className="mt-3 font-display text-lg font-semibold text-ink-strong">{nameOf}</h2>
      {/* B2677, bug 15 — the date is already the heading above when there is
          no title (`nameOf`); the subtitle names only the trip. */}
      <p className="text-sm text-ink-secondary">{tripTitle}</p>

      {/* Day card(s) — B2677 item 1. */}
      <ol className="mt-4 space-y-5">
        {rows.map((row, i) => {
          const entry = entries[i];
          const ss = suggestionState[i];
          const own = ownWords(entry);
          const applied = i === 0 ? ss.composeApplied : null;
          const text = applied ? appliedText : own;
          const images = entry?.gallery.filter((p) => p.type === "image") ?? [];
          // ponytail: "Edit" goes to the existing, already-correct
          // "Change a day" panel (`EditDayFlow`, resolves any draft or
          // published day by slug) rather than a new date-matching wire into
          // Write's own resume machinery — the ticket's "Edit → Write" is
          // read loosely here for that reason; see the Build notes.
          const editHref = `${journalPath(username)}/studio/day/edit?slug=${encodeURIComponent(row.slug)}`;
          const addPhotosHref = editHref;
          const variantTitles = i === 0 && composeResult && composeOpen ? composeResult[composeTab]?.titles.map((t) => t.text) ?? [] : [];
          const titleChoices = [...new Set([...(entry?.title ? [entry.title] : []), ...variantTitles])];
          return (
            <li key={row.slug} className="overflow-hidden rounded-2xl border border-line-quiet bg-surface-raised">
              {images.length > 0 ? (
                <div className="grid grid-cols-3 gap-0.5">
                  {images.slice(0, 3).map((p) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={p.src} src={`${p.src}?w=480`} alt={p.caption ?? ""} className="h-28 w-full object-cover" />
                  ))}
                  {/* B2677, bug 13 — the grid's own last cell, not only the
                      empty-state link below; the same Edit target (it can
                      add photos too). */}
                  <Link
                    href={addPhotosHref}
                    aria-label={t("studio.preview.addPhotos")}
                    className="flex h-28 w-full flex-col items-center justify-center gap-1 bg-surface-subtle text-xs font-semibold text-ink-strong"
                  >
                    <span aria-hidden className="text-lg leading-none">＋</span>
                  </Link>
                </div>
              ) : (
                <Link href={addPhotosHref} className="block px-4 py-3 text-sm font-semibold text-ink-body underline underline-offset-2">
                  {t("studio.preview.addPhotos")}
                </Link>
              )}
              <div className="space-y-3 p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-mono text-xs uppercase tracking-wide text-ink-secondary">
                    {[rows.length > 1 ? t("studio.flow.partHeading", { index: String(i + 1), total: String(rows.length) }) : null, entry?.time, entry?.location].filter(Boolean).join(" · ")}
                  </p>
                  <Link href={editHref} className="text-xs font-semibold text-ink-body underline underline-offset-2">
                    {t("studio.preview.edit")}
                  </Link>
                </div>

                {titleChoices.length > 0 && (
                  <fieldset>
                    <legend className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">{t("studio.check.titleLabel")}</legend>
                    <div className="mt-1 flex flex-wrap gap-2">
                      {[null, ...titleChoices].map((choice) => {
                        const on = ss.titleChoice === choice;
                        return (
                          <label
                            key={choice ?? "date"}
                            className={`inline-flex min-h-11 items-center rounded-full border px-3 text-sm font-semibold ${on ? "border-line-ink bg-action-strong text-on-action" : "border-dashed border-line-strong bg-surface-raised text-ink-strong"}`}
                          >
                            <input
                              type="radio"
                              name={`title-${row.slug}`}
                              className="sr-only"
                              checked={on}
                              onChange={() => setSuggestionState((prev) => prev.map((v, at) => (at === i ? pickTitle(v, choice) : v)))}
                            />
                            {choice ?? t("studio.check.noTitle")}
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>
                )}

                {applied ? (
                  // "Use this" — the variant's text, editable, undo
                  // available right below (B2689).
                  <div className="space-y-2">
                    <textarea
                      value={appliedText}
                      onChange={(e) => setAppliedText(e.target.value)}
                      rows={6}
                      className="w-full rounded-xl border-l-2 border-yellow-400 bg-surface-raised px-3 py-2 text-base leading-7 text-ink-body"
                    />
                    <button
                      type="button"
                      className="text-xs font-semibold text-ink-body underline underline-offset-2"
                      onClick={() => setSuggestionState((prev) => prev.map((v, at) => (at === i ? undoCompose(v) : v)))}
                    >
                      {t("studio.check.keepMine")}
                    </button>
                  </div>
                ) : (
                  <div className={`text-base leading-7 whitespace-pre-line ${own.trim() ? "text-ink-body" : "italic text-ink-faint"}`}>
                    {text.trim() ? text : t("studio.check.noWords")}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {/* ✦ Compose — B2689, replacing B2677 item 2's four blind calls.
          Absent, not disabled, with `helper` off (AGENTS.md: a capability
          off is never a greyed-out button). */}
      {helperEnabled && (
      <div className="mt-4">
        {composeConsenting ? (
          <ConfirmPanel
            label={t("studio.preview.composeConsentLabel")}
            question={t("studio.preview.composeConsent")}
            confirmLabel={t("studio.preview.composeConsentConfirm")}
            busy={false}
            onConfirm={() => void confirmComposeConsent()}
            onCancel={() => setComposeConsenting(false)}
          />
        ) : composeStatus === "nothing" ? (
          <p className="text-sm text-ink-secondary">{t("studio.preview.composeNothing")}</p>
        ) : composeStatus === "idle" || composeStatus === "error" ? (
          <button type="button" onClick={onComposeSuggestTap} className="min-h-11 rounded-full border border-line-strong px-4 text-sm font-semibold text-ink-strong">
            {t("studio.preview.composeSuggest")}
          </button>
        ) : composeStatus === "working" ? (
          <p className="text-sm text-ink-secondary">{t("studio.check.working")}</p>
        ) : composeStatus === "ready" && composeResult && !composeOpen && !suggestionState[0]?.composeApplied ? (
          <button
            type="button"
            onClick={() => setComposeOpen(true)}
            className="flex min-h-11 w-full items-center justify-between rounded-xl border border-dashed border-yellow-400 bg-surface-neutral px-4 text-sm font-semibold text-ink-strong"
          >
            <span>{t("studio.preview.composeReady")}</span>
            <span className="underline underline-offset-2">{t("studio.preview.composeRead")}</span>
          </button>
        ) : null}

        {/* Once a version is in use the part above holds it, editable, with
            its own "Keep mine"; the review closes so there is one of each
            (persona round, 2 Oct). */}
        {composeStatus === "ready" && composeResult && composeOpen && !suggestionState[0]?.composeApplied && (
          <div className="mt-2 space-y-3 rounded-xl border border-line-strong bg-surface-raised p-4">
            {/* Tabs — "Close to my words" / "As a story". C2: opens on
                Story when there is one, else Close; no Story tab at all
                when the day was too thin for one. */}
            <div className="flex gap-2" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={composeTab === "close"}
                onClick={() => setComposeTab("close")}
                className={`min-h-9 rounded-full border px-3 text-sm font-semibold ${composeTab === "close" ? "border-line-ink bg-action-strong text-on-action" : "border-line-strong text-ink-strong"}`}
              >
                {t("studio.preview.composeClose")}
              </button>
              {composeResult.story && (
                <button
                  type="button"
                  role="tab"
                  aria-selected={composeTab === "story"}
                  onClick={() => setComposeTab("story")}
                  className={`min-h-9 rounded-full border px-3 text-sm font-semibold ${composeTab === "story" ? "border-line-ink bg-action-strong text-on-action" : "border-line-strong text-ink-strong"}`}
                >
                  {t("studio.preview.composeStory")}
                </button>
              )}
            </div>

            {composeResult[composeTab] && (
              <div className="space-y-2 text-sm leading-6 text-ink-body">
                {composeShowSources ? (
                  // Each sentence with the chips it rests on — a claim and
                  // its source side by side (persona round, 2 Oct).
                  <ol className="space-y-2">
                    {composeResult[composeTab]!.sentences.map((sentence, idx) => (
                      <li key={idx}>
                        <span>{sentence.text} </span>
                        {sentence.sources.map((source, at) => (
                          <span key={`${source.id}-${at}`} className="ml-1 inline-flex items-center rounded-full border border-line-faint px-2 py-0.5 align-middle font-mono text-[11px] text-ink-secondary">
                            {source.kind === "owner" ? t("studio.preview.composeSourceOwner") : source.kind === "measured" ? t("studio.preview.composeSourceMeasured") : t("studio.preview.composeSourceSeen")}
                          </span>
                        ))}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="whitespace-pre-line">
                    {composeTab === "close"
                      ? wordDiff(ownWords(entries[0]), composeResult.close!.text).map((tok, idx) => (
                          <span key={idx} className={tok.changed ? "underline decoration-yellow-400 decoration-2 underline-offset-2" : ""}>
                            {tok.text}{" "}
                          </span>
                        ))
                      : composeResult.story!.text}
                  </p>
                )}
                <button type="button" aria-pressed={composeShowSources} className="text-xs font-semibold text-ink-body underline underline-offset-2" onClick={() => setComposeShowSources((v) => !v)}>
                  {composeShowSources ? t("studio.preview.composeSourcesHide") : t("studio.preview.composeSources")}
                </button>
                <div className="flex gap-2 pt-1">
                  <button type="button" onClick={() => applyComposeVariant(composeTab)} className="min-h-9 rounded-full bg-yellow-400 px-3 text-xs font-semibold text-yellow-950">
                    {t("studio.preview.composeUseThis")}
                  </button>
                  <button type="button" onClick={keepMineInstead} className="min-h-9 rounded-full border border-line-strong px-3 text-xs font-semibold text-ink-strong">
                    {t("studio.check.keepMine")}
                  </button>
                </div>
              </div>
            )}

            {/* Questions — C4/F3: a chip per missing question; answering it
                (typed or spoken) composes again, up to 3 answers total. */}
            {composeResult.missing.length > 0 && composeAnswers.length < MAX_COMPOSE_ANSWERS && (
              <div className="space-y-2 border-t border-line-faint pt-3">
                <div className="flex flex-wrap gap-2">
                  {composeResult.missing.map((q, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setComposeAnswering(idx)}
                      className="min-h-9 rounded-full border border-dashed border-line-strong px-3 text-xs font-semibold text-ink-strong"
                    >
                      {q.question}
                    </button>
                  ))}
                </div>
                {composeAnswering !== null && (
                  <div className="flex items-center gap-2">
                    <input
                      value={composeAnswerDraft}
                      onChange={(e) => setComposeAnswerDraft(e.target.value)}
                      placeholder={t("studio.preview.composeAnswerPlaceholder")}
                      className="min-h-10 flex-1 rounded-xl border border-line-strong bg-surface-base px-3 text-sm text-ink-body"
                    />
                    <button type="button" onClick={() => void addComposeAnswer()} className="min-h-10 rounded-full bg-yellow-400 px-3 text-sm font-semibold text-yellow-950">
                      {t("studio.preview.composeAddAnswer")}
                    </button>
                  </div>
                )}
                {composeAnswering !== null && speech && (
                  <div className="overflow-hidden rounded-xl border border-line-strong">
                    <SpeakTray
                      username={username}
                      speech={speech}
                      trip={chosen.tripId}
                      defaultLanguage={speech.defaultLanguage}
                      value={composeAnswerDraft}
                      setValue={setComposeAnswerDraft}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
      )}

      {/* Tags — item 3. */}
      <div className="mt-5">
        <p className="text-sm font-semibold text-ink-strong">{t("studio.preview.tagsTitle")}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {tagChips.map((chip) => (
            <button
              key={chip.tag}
              type="button"
              aria-pressed={chip.selected}
              onClick={() => saveTags(toggleTag(selectedTags, chip.tag))}
              className={`min-h-9 rounded-full border px-3 text-sm font-semibold ${
                // B2677, bug 12 — selected is dark with a check; every
                // unselected chip (a suggestion, whatever source it is) is
                // dashed, never solid-bordered.
                chip.selected ? "border-line-ink bg-action-strong text-on-action" : "border-dashed border-line-strong text-ink-strong"
              }`}
            >
              {chip.selected ? "✓ " : ""}
              {chip.tag}
            </button>
          ))}
          {aiTags.length > 0 && (
            <button type="button" onClick={() => saveTags(addAllAiTags(tagChips, selectedTags))} className="min-h-9 rounded-full border border-line-strong px-3 text-sm font-semibold text-ink-strong">
              {t("studio.preview.addAllTags")}
            </button>
          )}
          <form
            className="inline-flex items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (tagInput.trim()) saveTags(toggleTag(selectedTags, tagInput.trim()));
              setTagInput("");
            }}
          >
            <input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              placeholder="＋"
              aria-label={t("studio.preview.addTag")}
              className="min-h-9 w-16 rounded-full border border-line-strong bg-surface-raised px-3 text-sm text-ink-strong"
            />
          </form>
        </div>
      </div>

      {/* Languages — item 4. B2677, bug 9 — ONE row for every other locale,
          not one repeated per locale. */}
      {offerLocales.length > 0 && (
        <div className="mt-5">
          <p className="text-sm font-semibold text-ink-strong">
            {t("studio.preview.languagesTitle", {
              languages: new Intl.ListFormat(locale, { type: "conjunction" }).format(offerLocales.map((l) => languageName(l))),
              language: languageName(dayLanguage),
            })}
          </p>
          <div className="mt-2 space-y-2">
            {translateConsenting ? (
              <ConfirmPanel
                label={t("studio.preview.translateConsentLabel")}
                question={t("studio.preview.translateConsent")}
                confirmLabel={t("studio.preview.translateConsentConfirm")}
                busy={false}
                onConfirm={() => void confirmTranslateConsent()}
                onCancel={() => setTranslateConsenting(false)}
              />
            ) : (
              <div className="flex flex-wrap gap-2">
                {/* B2677, bug 10 — absent, not disabled, with `helper` off. */}
                {helperEnabled && (
                  <button type="button" disabled={translating} onClick={() => void runTranslate()} className="min-h-10 rounded-full border border-line-strong px-3 text-sm font-semibold text-ink-strong disabled:opacity-50">
                    {translating ? t("studio.check.working") : t("studio.preview.translate")}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    // Held against the main part only (index 0) — the one
                    // part this page offers a review box for.
                    setLangDrafts((prev) =>
                      prev.map((d, at) => (at === 0 ? { ...d, ...Object.fromEntries(offerLocales.map((l) => [l, d[l] ?? { title: "", content: "" }])) } : d)),
                    );
                    setLangAnswer("mine");
                    saveLanguageAnswer(username, tripId, "mine");
                  }}
                  className="min-h-10 rounded-full border border-line-strong px-3 text-sm font-semibold text-ink-strong"
                >
                  {t("studio.preview.writeMyself")}
                </button>
                <button type="button" onClick={declineLanguage} className="min-h-10 rounded-full border border-line-strong px-3 text-sm font-semibold text-ink-strong">
                  {t("studio.preview.languageFine", { language: languageName(dayLanguage) })}
                </button>
              </div>
            )}
            {/* ✦ Translate's own results — one collapsible per locale, the
                main part's text (B2685: every part is translated and
                persisted; this is the one review box the page offers). */}
            {langAnswer === "translate" &&
              offerLocales.map((toLocale) => (
                <details key={toLocale} className="rounded-xl border border-line-strong px-3 py-2">
                  <summary className="cursor-pointer text-sm font-semibold text-ink-strong">{languageName(toLocale)}</summary>
                  {langDrafts[0]?.[toLocale] ? (
                    <textarea
                      value={langDrafts[0][toLocale].content}
                      onChange={(e) => setLangDrafts((prev) => prev.map((d, at) => (at === 0 ? { ...d, [toLocale]: { ...d[toLocale], content: e.target.value } } : d)))}
                      onBlur={() => saveTranslations()}
                      rows={4}
                      className="mt-2 w-full rounded-xl border border-line-strong bg-surface-raised px-3 py-2 text-sm text-ink-strong"
                    />
                  ) : (
                    <p className="mt-2 text-sm text-ink-secondary">{t("studio.check.working")}</p>
                  )}
                </details>
              ))}
            {/* "Write it myself" — one textarea per locale, the main part. */}
            {langAnswer === "mine" &&
              offerLocales.map((toLocale) => (
                <label key={toLocale} className="block text-xs font-semibold uppercase tracking-wide text-ink-secondary">
                  {languageName(toLocale)}
                  <textarea
                    value={langDrafts[0]?.[toLocale]?.content ?? ""}
                    onChange={(e) => setLangDrafts((prev) => prev.map((d, at) => (at === 0 ? { ...d, [toLocale]: { title: d[toLocale]?.title ?? "", content: e.target.value } } : d)))}
                    onBlur={() => saveTranslations()}
                    rows={4}
                    className="mt-1 w-full rounded-xl border border-line-strong bg-surface-raised px-3 py-2 text-sm font-normal normal-case text-ink-strong"
                  />
                </label>
              ))}
            {langAnswer === "default" && <p className="text-sm text-ink-secondary">{t("studio.preview.languageFineNote", { language: languageName(defaultLocale) })}</p>}
          </div>
        </div>
      )}

      {/* Readers / Message — item 5. B2677, bug 11 — the two fact rows the
          design calls for, replacing the old explanatory sentences
          ("Publishing tells nobody: nobody you chose has app notifications
          or email on."). */}
      <dl className="mt-5 space-y-3 rounded-xl border border-line-faint bg-surface-subtle px-4 py-3 text-sm text-ink-body">
        <div className="flex items-start justify-between gap-3">
          <div>
            <dt className="font-semibold text-ink-strong">{t("studio.preview.readersTitle")}</dt>
            <dd data-audience={chosen.audience}>
              {readers1.kind === "everyone"
                ? t("studio.preview.readers.everyone")
                : readers1.kind === "private"
                  ? tn("studio.preview.readers.private", readers1.count, { count: String(readers1.count) })
                  : tn("studio.preview.readers.guest", readers1.count, { count: String(readers1.count) })}
              {readers1.kind !== "everyone" && <span className="block text-ink-secondary">{readerNames ?? t("studio.preview.readers.onlyThem")}</span>}
            </dd>
          </div>
          <button type="button" onClick={() => setChanging((v) => !v)} className="min-h-9 flex-none rounded-full border border-line-strong px-3 text-xs font-semibold text-ink-strong">
            {t("studio.preview.change")}
          </button>
        </div>
        <div>
          <dt className="font-semibold text-ink-strong">{t("studio.preview.messageTitle")}</dt>
          <dd>
            {message1.kind === "serverOff"
              ? t("studio.preview.message.serverOff")
              : message1.kind === "noneYet"
                ? t("studio.preview.message.noneYet")
                : message1.kind === "chosenNone"
                  ? t("studio.preview.message.chosenNone")
                  : [
                      message1.push > 0 ? tn("studio.preview.message.app", message1.push, { count: String(message1.push) }) : null,
                      message1.mail > 0 ? tn("studio.preview.message.mail", message1.mail, { count: String(message1.mail) }) : null,
                    ]
                      .filter(Boolean)
                      .join(", ")}
          </dd>
        </div>
        {changing && (
          <div className="space-y-3 border-t border-line-faint pt-3">
            <fieldset>
              <legend className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">{t("studio.publish.whoTitle")}</legend>
              {(["", "guest", "private"] as const).map((v) => (
                <label key={v || "public"} className="flex min-h-9 items-center gap-2">
                  <input type="radio" name="visibility" checked={visibility === v} onChange={() => setVisibility(v)} />
                  {t(`studio.publish.who.${v === "" ? "public" : v}` as TranslationKey)}
                </label>
              ))}
            </fieldset>
            <TellWho tell={tell} selected={tellGroups} onSelect={setTellGroups} mail={tellMail} onMail={setTellMail} />
            <button type="button" onClick={() => saveChange()} className="min-h-10 rounded-full bg-yellow-400 px-4 text-sm font-semibold text-yellow-950">
              {t("studio.preview.saveChange")}
            </button>
          </div>
        )}
      </dl>

      <p className="mt-4 text-sm text-ink-secondary">{t("studio.preview.takeDownNote")}</p>
      {!online && <p className="mt-2 text-sm text-ink-secondary">{t("studio.publish.offline")}</p>}
      {publishError && <p role="alert" className="mt-2 text-sm text-coral-600">{publishError}</p>}
      {/* B2677, bug 8 — one primary button, the sticky bar's own
          (`useStudioBar(..., { desktop: true })` above already shows it on
          both desktop and phone); this page never draws a second one. */}
    </div>
  );
}
