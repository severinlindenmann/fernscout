"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import ConfirmPanel from "@/components/ConfirmPanel";
import BusyButton from "@/components/BusyButton";
import { useI18n } from "@/components/LocaleProvider";
import { useStudioBar } from "@/components/studio/StudioBar";
import { useOnline } from "@/components/studio/useOnline";
import PublishedDay from "@/components/studio/day/PublishedDay";
import TellWho, { tellCounts, type TellProps } from "@/components/studio/day/TellWho";
import { journalPath } from "@/lib/journalPath";
import { NO_PROSE } from "@/lib/helper/draft";
import { missingConsentScopes, type ConsentScopes } from "@/lib/studio/featureConsent";
import { messageFact, publishAudienceLabel, readersFact } from "@/lib/studio/publishAudience";
import { addAllAiTags, matchingUsedBeforeTags, mergeTags, tagPhotoIds, toggleTag, type TagChip } from "@/lib/studio/tagsMerge";
import { readLanguageAnswer, saveLanguageAnswer, type LanguageAnswer } from "@/lib/studio/languageAnswer";
import { initialSuggestionState, pickTitle, addCaptions, acceptSpelling, undoSpelling, type SuggestionState } from "@/lib/studio/suggestionState";
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
};
type Suggestions = {
  status: "waiting" | "working" | "done" | "failed";
  tidied?: string;
  titles?: string[];
  captions?: Record<string, string>;
};

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
}) {
  const { t, tn, formatLongDate, languageName, locale } = useI18n();
  const online = useOnline();
  const user = encodeURIComponent(username);
  const rows = [chosen, ...also];

  const [entries, setEntries] = useState<(Entry | null)[]>(rows.map(() => null));
  const [ideas, setIdeas] = useState<Suggestions[]>(rows.map(() => ({ status: "waiting" })));
  const [suggestionState, setSuggestionState] = useState<SuggestionState[]>(rows.map(() => initialSuggestionState()));
  const [suggesting, setSuggesting] = useState(false);
  const [suggestConsenting, setSuggestConsenting] = useState(false);
  const [suggested, setSuggested] = useState(false);
  const [aiTags, setAiTags] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [tagInput, setTagInput] = useState("");
  const seededTags = useRef(false);


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

  /** ✦ Suggest — B2677 item 2+3: tidied words, titles and captions per part,
   *  plus one whole-day call for AI tags. Nothing is applied here; each
   *  result lands as a dashed card the owner still has to tap. */
  async function runSuggest() {
    setSuggesting(true);
    await Promise.all(
      rows.map(async (row, i) => {
        const entry = entries[i];
        const merge = (patch: Partial<Suggestions>) => setIdeas((prev) => prev.map((s, at) => (at === i ? { ...s, ...patch } : s)));
        merge({ status: "working" });
        const hasWords = !!entry && words(ownWords(entry)) > 0;
        const polish = hasWords
          ? post("day/write-day", { trip: row.tripId, notes: entry!.content, mode: "polish", date: row.date }).then((r) => {
              const prose = (r.json?.draft as { prose?: string } | undefined)?.prose;
              if (r.ok && prose && prose.trim() !== entry!.content.trim()) merge({ tidied: prose });
            })
          : null;
        const titles = hasWords
          ? post("day/write-day", { trip: row.tripId, notes: entry!.content, mode: "titles", date: row.date }).then((r) => {
              if (r.ok && Array.isArray(r.json?.titles)) merge({ titles: (r.json.titles as unknown[]).filter((v): v is string => typeof v === "string" && v.trim() !== "") });
            })
          : null;
        const captions = entry?.gallery.some((p) => p.type === "image")
          ? post("day/describe-photos", { trip: row.tripId, slug: row.slug }).then((r) => {
              const list = r.json?.captions as { src: string; caption?: string; skipped?: string }[] | undefined;
              if (r.ok && list) merge({ captions: Object.fromEntries(list.filter((c) => c.caption && !c.skipped).map((c) => [c.src, c.caption!])) });
            })
          : null;
        await Promise.all([polish, titles, captions]);
        merge({ status: "done" });
      }),
    );
    const allWords = entries.map((e) => ownWords(e)).filter(Boolean).join("\n\n");
    if (allWords) {
      // B2685 — the day's own photographs ride along, up to the route's own
      // cap (`tagPhotoIds`); `onSuggestTap`/`confirmSuggestConsent` never let
      // `runSuggest` start without the "photos" scope already granted
      // (`missingConsentScopes("suggest", …)` needs both `words` and
      // `photos`), so there is nothing left to ask here.
      const photoIds = tagPhotoIds(entries.filter((e): e is Entry => !!e));
      const r = await post("day/write-day", { trip: chosen.tripId, content: allWords, mode: "tags", date: chosen.date, ...(photoIds.length > 0 ? { photoIds } : {}) });
      if (r.ok && Array.isArray(r.json?.tags)) setAiTags((r.json.tags as unknown[]).filter((v): v is string => typeof v === "string"));
    }
    setSuggesting(false);
    setSuggested(true);
  }

  function onSuggestTap() {
    if (!helperEnabled) return;
    if (missingConsentScopes("suggest", consentNow).length > 0) {
      setSuggestConsenting(true);
      return;
    }
    void runSuggest();
  }

  async function confirmSuggestConsent() {
    for (const scope of missingConsentScopes("suggest", consentNow)) await agree(scope);
    setSuggestConsenting(false);
    void runSuggest();
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

  /** B2685 — a part's own final title/words: the picked title (or the date,
   *  "keep the date" being the default) and the accepted tidy, not the
   *  original — the same two choices `persistChoices` below already reads
   *  off `suggestionState`/`ideas` before it writes a part. */
  function finalTitle(i: number): string {
    return suggestionState[i]?.titleChoice || entries[i]?.title || "";
  }
  function finalContent(i: number): string {
    const ss = suggestionState[i];
    const idea = ideas[i];
    return ss?.spellingApplied && idea?.tidied ? idea.tidied : ownWords(entries[i]);
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
      for (const toLocale of otherLocales) {
        const r = await post("day/write-day", { trip: rows[i].tripId, mode: "translate", to: toLocale, title, content, date: rows[i].date });
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
      const idea = ideas[i];
      const ss = suggestionState[i];
      const body: Record<string, unknown> = { trip: rows[i].tripId, slug: rows[i].slug };
      if (ss.spellingApplied && idea.tidied) body.content = idea.tidied;
      if (ss.titleChoice && ss.titleChoice !== entry?.title) body.title = ss.titleChoice;
      if (ss.captionsOn && idea.captions && Object.keys(idea.captions).length > 0) body.captions = idea.captions;
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

  if (published) {
    const nobodyTold = published.told.app === 0 && published.told.mail === 0;
    const readerLine =
      audienceLabel.kind === "readers"
        ? nobodyTold
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
          const s = ideas[i];
          const ss = suggestionState[i];
          const own = ownWords(entry);
          const showTidied = !!s.tidied && ss.spellingApplied;
          const text = showTidied ? s.tidied! : own;
          const images = entry?.gallery.filter((p) => p.type === "image") ?? [];
          // ponytail: "Edit" goes to the existing, already-correct
          // "Change a day" panel (`EditDayFlow`, resolves any draft or
          // published day by slug) rather than a new date-matching wire into
          // Write's own resume machinery — the ticket's "Edit → Write" is
          // read loosely here for that reason; see the Build notes.
          const editHref = `${journalPath(username)}/studio/day/edit?slug=${encodeURIComponent(row.slug)}`;
          const addPhotosHref = editHref;
          const titleChoices = [...new Set([...(entry?.title ? [entry.title] : []), ...(s.titles ?? [])])];
          return (
            <li key={row.slug} className="overflow-hidden rounded-2xl border border-line-quiet bg-surface-raised">
              {images.length > 0 ? (
                <div className="grid grid-cols-3 gap-0.5">
                  {images.slice(0, 3).map((p) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={p.src} src={`${p.src}?w=480`} alt={s.captions?.[p.src] ?? p.caption ?? ""} className="h-28 w-full object-cover" />
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

                {(titleChoices.length > 0 || s.titles) && (
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

                <div className={`text-base leading-7 whitespace-pre-line ${own.trim() ? "text-ink-body" : "italic text-ink-faint"} ${showTidied ? "border-l-2 border-yellow-400 pl-3" : ""}`}>
                  {text.trim() ? text : t("studio.check.noWords")}
                </div>
                {s.tidied && !ss.spellingApplied && (
                  <div className="rounded-lg border border-dashed border-yellow-400 bg-surface-neutral px-3 py-2 text-sm leading-6 whitespace-pre-line text-ink-secondary">
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-strong">{tn("studio.check.lookingAt", 1, { count: "3" })}</p>
                    {s.tidied}
                    <div className="mt-2 flex gap-2">
                      <button type="button" className="min-h-9 rounded-full bg-yellow-400 px-3 text-xs font-semibold text-yellow-950" onClick={() => setSuggestionState((prev) => prev.map((v, at) => (at === i ? acceptSpelling(v) : v)))}>
                        {t("studio.check.useTidied")}
                      </button>
                    </div>
                  </div>
                )}
                {s.tidied && ss.spellingApplied && (
                  <button type="button" className="text-xs font-semibold text-ink-body underline underline-offset-2" onClick={() => setSuggestionState((prev) => prev.map((v, at) => (at === i ? undoSpelling(v) : v)))}>
                    {t("studio.check.keepMine")}
                  </button>
                )}
                {s.captions && Object.keys(s.captions).length > 0 && !ss.captionsOn && (
                  <button
                    type="button"
                    className="min-h-9 rounded-full border border-dashed border-line-strong px-3 text-xs font-semibold text-ink-strong"
                    onClick={() => setSuggestionState((prev) => prev.map((v, at) => (at === i ? addCaptions(v) : v)))}
                  >
                    {tn("studio.check.captions", Object.keys(s.captions).length, { count: String(Object.keys(s.captions).length) })}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {/* ✦ Suggest — item 2. B2677, bug 10 — absent, not disabled, with
          `helper` off (AGENTS.md: a capability off is never a greyed-out
          button). */}
      {helperEnabled && (
      <div className="mt-4">
        {suggestConsenting ? (
          <ConfirmPanel
            label={t("studio.preview.suggestConsentLabel")}
            question={t("studio.preview.suggestConsent")}
            confirmLabel={t("studio.preview.suggestConsentConfirm")}
            busy={false}
            onConfirm={() => void confirmSuggestConsent()}
            onCancel={() => setSuggestConsenting(false)}
          />
        ) : (
          <button type="button" disabled={suggesting} onClick={onSuggestTap} className="min-h-11 rounded-full border border-line-strong px-4 text-sm font-semibold text-ink-strong disabled:opacity-50">
            {suggesting ? t("studio.check.working") : suggested ? t("studio.preview.suggestAgain") : t("studio.preview.suggest")}
          </button>
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
      {otherLocales.length > 0 && (
        <div className="mt-5">
          <p className="text-sm font-semibold text-ink-strong">
            {t("studio.preview.languagesTitle", {
              languages: new Intl.ListFormat(locale, { type: "conjunction" }).format(otherLocales.map((l) => languageName(l))),
              language: languageName(defaultLocale),
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
                      prev.map((d, at) => (at === 0 ? { ...d, ...Object.fromEntries(otherLocales.map((l) => [l, d[l] ?? { title: "", content: "" }])) } : d)),
                    );
                    setLangAnswer("mine");
                    saveLanguageAnswer(username, tripId, "mine");
                  }}
                  className="min-h-10 rounded-full border border-line-strong px-3 text-sm font-semibold text-ink-strong"
                >
                  {t("studio.preview.writeMyself")}
                </button>
                <button type="button" onClick={declineLanguage} className="min-h-10 rounded-full border border-line-strong px-3 text-sm font-semibold text-ink-strong">
                  {t("studio.preview.languageFine", { language: languageName(defaultLocale) })}
                </button>
              </div>
            )}
            {/* ✦ Translate's own results — one collapsible per locale, the
                main part's text (B2685: every part is translated and
                persisted; this is the one review box the page offers). */}
            {langAnswer === "translate" &&
              otherLocales.map((toLocale) => (
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
              otherLocales.map((toLocale) => (
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
