"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
import { publishAudienceLabel } from "@/lib/studio/publishAudience";
import { addAllAiTags, mergeTags, toggleTag, type TagChip } from "@/lib/studio/tagsMerge";
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
  date,
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
  date: string;
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
  const { t, tn, formatLongDate, languageName } = useI18n();
  const router = useRouter();
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
  const [langDrafts, setLangDrafts] = useState<Record<string, { title: string; content: string }>>({});
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
      const r = await post("day/write-day", { trip: chosen.tripId, content: allWords, mode: "tags", date: chosen.date });
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
  const tagChips: TagChip[] = mergeTags(place, usedBeforeTags, aiTags, selectedTags);

  // Tags, translations and this day's visibility are held here and written
  // once, in order, by `persistChoices` right before publishing — never one
  // PATCH per tap, which raced its own If-Match and lost the second write.
  function saveTags(next: Set<string>) {
    setSelectedTags(next);
  }

  // Languages — ✦ Translate / Write it myself / "<language> is fine".
  async function runTranslate(locale: string) {
    if (missingConsentScopes("translate", consentNow).length > 0) {
      setTranslateConsenting(true);
      return;
    }
    setTranslating(true);
    const r = await post("day/write-day", { trip: chosen.tripId, mode: "translate", to: locale, title: entries[0]?.title ?? "", content: entries[0]?.content ?? "", date: chosen.date });
    setTranslating(false);
    if (r.ok) {
      setLangDrafts((prev) => ({ ...prev, [locale]: { title: String(r.json?.title ?? ""), content: String(r.json?.content ?? "") } }));
      setLangAnswer("translate");
      saveLanguageAnswer(username, tripId, "translate");
    }
  }

  async function confirmTranslateConsent(locale: string) {
    await agree("words");
    setTranslateConsenting(false);
    void runTranslate(locale);
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
      // no-refresh: the publish that follows refreshes the router once.
      const response = await fetch(`/api/helper/${user}/day`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }).catch(() => null);
      if (!response?.ok) return null;
      const json = (await response.json().catch(() => null)) as { draft?: { slug?: string } } | null;
      slugs[i] = json?.draft?.slug ?? rows[i].slug;
    }
    const main = slugs[0];
    const patch: Record<string, unknown> = {};
    if (selectedTags.size > 0) patch.tags = [...selectedTags];
    if (Object.keys(langDrafts).length > 0) patch.translations = langDrafts;
    if (visibility) patch.visibility = visibility;
    else if (blank.includes("visibility")) patch.declined = { visibility: "shown to everyone the trip lets in" };
    if (Object.keys(patch).length > 0) {
      const dayUrl = `/api/web/${user}/trips/${encodeURIComponent(chosen.tripId)}/days/${encodeURIComponent(main)}`;
      const head = await fetch(dayUrl).then((r) => (r.ok ? r.json() : null)).catch(() => null) as { etag?: string } | null;
      // no-refresh: the publish that follows refreshes the router once.
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
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body }).catch(() => null);
    const json = (await response?.json().catch(() => null)) as { told?: { app: number; mail: number } } | null;
    setPublishing(false);
    if (response?.ok) {
      router.refresh();
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
    const readerLine =
      audienceLabel.kind === "readers"
        ? tn("studio.published.told", audienceLabel.count, { count: String(audienceLabel.count), app: String(published.told.app), mail: String(published.told.mail) })
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

  return (
    <div className="mt-2">
      <Link href={backHref} className="inline-block text-sm font-semibold text-ink-body underline underline-offset-2">
        {t("studio.publish.backToDrafts")}
      </Link>
      <h2 className="mt-3 font-display text-lg font-semibold text-ink-strong">{nameOf}</h2>
      <p className="text-sm text-ink-secondary">{tripTitle} · {formatLongDate(date)}</p>

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

      {/* ✦ Suggest — item 2. */}
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
          <button type="button" disabled={suggesting || !helperEnabled} onClick={onSuggestTap} className="min-h-11 rounded-full border border-line-strong px-4 text-sm font-semibold text-ink-strong disabled:opacity-50">
            {suggesting ? t("studio.check.working") : suggested ? t("studio.preview.suggestAgain") : t("studio.preview.suggest")}
          </button>
        )}
      </div>

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
                chip.selected ? "border-line-ink bg-action-strong text-on-action" : chip.source === "ai" ? "border-dashed border-line-strong text-ink-strong" : "border-line-strong text-ink-strong"
              }`}
            >
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

      {/* Languages — item 4. */}
      {otherLocales.length > 0 && (
        <div className="mt-5">
          <p className="text-sm font-semibold text-ink-strong">{t("studio.preview.languagesTitle", { reader: languageName(otherLocales[0]), language: languageName(defaultLocale) })}</p>
          {otherLocales.map((locale) => (
            <div key={locale} className="mt-2 space-y-2">
              {translateConsenting ? (
                <ConfirmPanel
                  label={t("studio.preview.translateConsentLabel")}
                  question={t("studio.preview.translateConsent")}
                  confirmLabel={t("studio.preview.translateConsentConfirm")}
                  busy={false}
                  onConfirm={() => void confirmTranslateConsent(locale)}
                  onCancel={() => setTranslateConsenting(false)}
                />
              ) : (
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={translating} onClick={() => void runTranslate(locale)} className="min-h-10 rounded-full border border-line-strong px-3 text-sm font-semibold text-ink-strong disabled:opacity-50">
                    {translating ? t("studio.check.working") : t("studio.preview.translate")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setLangDrafts((prev) => ({ ...prev, [locale]: prev[locale] ?? { title: "", content: "" } }));
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
              {langDrafts[locale] && (
                <textarea
                  value={langDrafts[locale].content}
                  onChange={(e) => setLangDrafts((prev) => ({ ...prev, [locale]: { ...prev[locale], content: e.target.value } }))}
                  onBlur={() => saveTranslations()}
                  rows={4}
                  className="w-full rounded-xl border border-line-strong bg-surface-raised px-3 py-2 text-sm text-ink-strong"
                />
              )}
              {langAnswer === "default" && <p className="text-sm text-ink-secondary">{t("studio.preview.languageFineNote", { language: languageName(defaultLocale) })}</p>}
            </div>
          ))}
        </div>
      )}

      {/* Readers / Message — item 5. */}
      <dl className="mt-5 space-y-3 rounded-xl border border-line-faint bg-surface-subtle px-4 py-3 text-sm text-ink-body">
        <div className="flex items-start justify-between gap-3">
          <div>
            <dt className="font-semibold text-ink-strong">{t("studio.publish.whoTitle")}</dt>
            <dd data-audience={chosen.audience}>{t(`studio.publish.who.${chosen.audience}` as TranslationKey)}</dd>
          </div>
          <button type="button" onClick={() => setChanging((v) => !v)} className="min-h-9 flex-none rounded-full border border-line-strong px-3 text-xs font-semibold text-ink-strong">
            {t("studio.preview.change")}
          </button>
        </div>
        <div>
          <dt className="font-semibold text-ink-strong">{t("studio.publish.tellTitle")}</dt>
          <dd>
            {counts.told > 0 ? tn("studio.publish.tellSummary", counts.told, { count: String(counts.told) }) : t("studio.publish.tellNobody")}
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
      <div className="mt-2 md:hidden">
        <BusyButton busy={publishing} type="button" className={PRIMARY} disabled={!online} onClick={() => void doPublish()}>
          {publishLabel}
        </BusyButton>
      </div>
    </div>
  );
}
