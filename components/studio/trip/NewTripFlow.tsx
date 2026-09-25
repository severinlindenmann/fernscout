"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useI18n } from "@/components/LocaleProvider";
import StepPrimary from "@/components/studio/StepPrimary";
import SubmitError from "@/components/studio/SubmitError";
import DateField from "@/components/studio/DateField";
import DoneScreen, { type DoneNext } from "@/components/studio/DoneScreen";
import { useOnline } from "@/components/studio/useOnline";
import { hasOutbox, newIntent, openOutboxStore } from "@/lib/outbox";
import { useStep } from "@/lib/studio/useStep";
import type { ExistingTripSummary, NewTripContact, NewTripFigure } from "@/lib/studio/newTrip";
import type { TranslationKey } from "@/lib/i18n";
import StepBody from "@/components/studio/StepBody";

/** One screen since B2187 — not a wizard, so no step indicator and no
 *  check list. `useStep` stays for its session draft alone (B2077): a reload
 *  keeps what was typed. The overlap notice, done and a failed write are
 *  outcomes of that screen, not steps a reload or Back should land on. */
const STEPS = ["form"] as const;
type Outcome = "overlap" | "done" | "writeFailed" | "queued";

const SKIP = "none";

/** A pill toggle, always a real tap target — B2021, spec: "every chip a
 *  44px target with a visible label". Used for every one-of-many choice on
 *  the "rest" step (money, languages, figures, company, the locked card). */
function Chip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-semibold ${
        active
          ? "border-action-strong bg-surface-subtle text-ink-strong"
          : "border-line-strong bg-surface-raised text-ink-secondary"
      }`}
    >
      {label}
    </button>
  );
}

/** `GET /api/v2/{user}/figures/preview` — the same route an agent already
 *  confirms a figure through (see that route's own doc comment): read-only,
 *  draws from the query alone, nothing stored. `party` draws several
 *  figures arranged as the hero would; `figure` draws one. */
function previewSrc(username: string, query: { figure: unknown } | { party: unknown }, size = 64): string {
  const [key, value] = "figure" in query ? (["figure", query.figure] as const) : (["party", query.party] as const);
  return `/api/v2/${encodeURIComponent(username)}/figures/preview?${key}=${encodeURIComponent(JSON.stringify(value))}&size=${size}`;
}

/** One figure in the "choose" picker, or in a read-only preview strip —
 *  B2021, review: "show the figures drawn … as small images with the name
 *  beneath, not name chips." `onClick` absent renders a plain, unselectable
 *  tile (the "these people" and "the journal's set" previews). */
function FigureTile({
  username,
  figure,
  label,
  active,
  onClick,
}: {
  username: string;
  figure: unknown;
  label: string;
  active?: boolean;
  onClick?: () => void;
}) {
  const body = (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- a live SVG
          from this journal's own preview route, not a static asset Next's
          image pipeline could optimise. */}
      <img src={previewSrc(username, { figure })} alt="" width={56} height={56} className="h-14 w-14" />
      <span className="max-w-20 truncate text-xs font-semibold text-ink-body">{label}</span>
    </>
  );
  if (!onClick) {
    return <div className="flex min-h-11 flex-col items-center gap-1 rounded-xl p-2">{body}</div>;
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex min-h-11 flex-col items-center gap-1 rounded-xl border p-2 ${
        active ? "border-action-strong bg-surface-subtle" : "border-line-strong bg-surface-raised"
      }`}
    >
      {body}
    </button>
  );
}

/** One of the "rest" step's five questions — a label, its answer chips, and
 *  an optional note or expanded control beneath them. */
function RestCard({ label, note, children }: { label: string; note?: string; children: ReactNode }) {
  return (
    <div className="mt-4 rounded-xl border border-line-strong bg-surface-raised p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">{label}</p>
      <div className="mt-2 flex flex-wrap gap-2">{children}</div>
      {note && <p className="mt-2 text-xs text-ink-secondary">{note}</p>}
    </div>
  );
}

/**
 * One swatch class per `ACCENTS` entry (`lib/tripWrite.ts`), written out
 * literally rather than interpolated (`` `bg-${a}-400` ``) — Tailwind's build
 * only ever picks up class names it can see as whole strings in the source,
 * and `components/SignupWizard.tsx`'s own accent picker sidesteps the same
 * trap by using plain radio labels with no swatch at all. This keeps the
 * swatch spec §7.2's storyboard actually draws, without risking a colour
 * that silently renders as nothing once the CSS is purged.
 */
const ACCENT_SWATCH: Record<string, string> = {
  sky: "bg-sky-400",
  yellow: "bg-yellow-400",
  green: "bg-green-500",
  coral: "bg-coral-400",
  navy: "bg-navy-400",
};

/**
 * "A new trip" — B1821, spec §7.2; one screen since B2187.
 *
 * The screen asks what the server needs — a title and two dates — plus who
 * can read it, already answered "Only you" (`private`, never the journal's
 * default, which is public on a public journal). Every other question of
 * the old four-step wizard sits under "More settings", collapsed, with the
 * same defaults and the same state; opening it changes nothing that is
 * sent. A one-screen form has nothing to review, so it ends in "Create
 * trip", not in a `DecideList`. `visibilities` and
 * `accents` arrive as props rather than an import from `lib/tripWrite.ts`
 * directly — that module is `server-only`, and `components/SignupWizard.tsx`
 * already hit this same wall and left the comment explaining it; the server
 * page component (`app/[user]/studio/trip/new/page.tsx`) is what actually
 * imports the real lists, this only renders the ones it was handed.
 *
 * **The trap this flow exists to avoid (spec §7.2):** `POST
 * /api/helper/[user]/trip` refuses a create silent on `accent`, `tagline`,
 * `intro` and `rates` — but only once, at the moment of commit
 * (`HELPER_TRIP_DECLINE_REASONS`), never before. Skipping one of the four — or
 * never opening "More settings" at all — writes the wire sentinel `"none"`
 * rather than omitting the field, so this page can never be more permissive
 * than the chat path it replaces (`create_trip`).
 *
 * **T3! stays a pre-write confirm, never a post-write correction.** The
 * overlapping-dates notice is computed from the candidate dates against
 * `existingTrips` *before* `commit()` runs — the same "nothing is written
 * before the last step" rule the day flow's own D3 collision confirm
 * follows — rather than creating the trip first and offering to patch its
 * dates afterwards. The obvious alternative (create, then `PATCH .../trip`
 * if the person wants different dates) was tried and reverted: that route
 * carries `isEnabled("helper", …)`, which is off on a default instance —
 * exactly where this plain-form flow (B754's own reasoning on the create
 * route) is the only door — so "Change these dates" would have failed with
 * `helper_disabled` on the install this flow exists for.
 */
export default function NewTripFlow({
  username,
  visibilities,
  accents,
  existingTrips,
  whatsappAvailable,
  otherLocales,
  defaultLocale,
  baseCurrency,
  currencies,
  contacts,
  figures,
  journalFigures,
  initialRange,
  photoRun = null,
}: {
  username: string;
  /** `VISIBILITIES` from `lib/tripWrite.ts`, read server-side. */
  visibilities: readonly string[];
  /** `ACCENTS` from `lib/tripWrite.ts`, read server-side. */
  accents: readonly string[];
  /** For T3! — see `lib/studio/newTrip.ts`'s own doc comment. */
  existingTrips: ExistingTripSummary[];
  whatsappAvailable: boolean;
  /** `lib/studio/newTrip.ts`'s `restForNewTrip` — see its own doc comment. */
  otherLocales: string[];
  defaultLocale: string;
  baseCurrency: string;
  /** `journalCurrencies` (`lib/rates.ts`) — base first; the only codes this
   *  flow offers (B2143). */
  currencies: string[];
  contacts: NewTripContact[];
  figures: NewTripFigure[];
  journalFigures: NewTripFigure[];
  /** B2193 — `?start=&end=` from a hub day card or "start from my photos":
   *  the dates prefilled, and how many waiting photographs they span. The
   *  name is never prefilled (C7). */
  initialRange?: { start: string; end: string; photos: number };
  /** The first run of waiting photographs no trip covers, for the link. */
  photoRun?: { start: string; end: string } | null;
}) {
  const { t, tn, locale, formatLongDate, formatShortDate, languageName: langName } = useI18n();

  const [title, setTitle] = useState("");
  // B2070 — an empty title is said under the field once it has been left.
  const [titleLeft, setTitleLeft] = useState(false);
  const [start, setStart] = useState(initialRange?.start ?? "");
  const [end, setEnd] = useState(initialRange?.end ?? "");
  const [visibility, setVisibility] = useState<string>("private");

  const [accent, setAccent] = useState<string>("");
  const [accentSkipped, setAccentSkipped] = useState(false);
  const [tagline, setTagline] = useState("");
  const [taglineSkipped, setTaglineSkipped] = useState(false);
  const [intro, setIntro] = useState("");
  const [introSkipped, setIntroSkipped] = useState(false);
  const [rates, setRates] = useState("");
  const [ratesSkipped, setRatesSkipped] = useState(false);

  // "More settings" — B2021's "rest", folded under one disclosure by B2187.
  // Every one of these has a real default, the locked card included (B2185).
  const [money, setMoney] = useState<"none" | "budget">("none");
  const [budgetTotal, setBudgetTotal] = useState("");
  const [budgetCurrency, setBudgetCurrency] = useState(baseCurrency);
  const [languages, setLanguages] = useState<"later" | "add">("later");
  const [languageTitles, setLanguageTitles] = useState<Record<string, string>>({});
  /** "Subtitles too" — review point 4: one link reveals a subtitle field
   *  per language, rather than asking for both up front. */
  const [showSubtitles, setShowSubtitles] = useState(false);
  const [languageSubtitles, setLanguageSubtitles] = useState<Record<string, string>>({});
  const [figuresChoice, setFiguresChoice] = useState<"journal" | "none" | "custom">("journal");
  const [chosenFigures, setChosenFigures] = useState<string[]>([]);
  /** "See the journal's set" — review point 6: a drawn preview of what "the
   *  journal's own" actually draws, not just the words. */
  const [showJournalSet, setShowJournalSet] = useState(false);
  const [company, setCompany] = useState<"later" | "solo" | "named">("later");
  const [namedEmails, setNamedEmails] = useState<string[]>([]);
  /** "Show nothing" preselected, no gate (B2185, owner decision D2) — a
   *  locked card tells a stranger a closed trip exists at all, so the
   *  closed-by-default answer is the one nobody has to choose. Turning it
   *  on is still one tap away, here and in trip settings. */
  const [teaser, setTeaser] = useState(false);

  const needsTeaser = visibility !== "public";
  const budgetMissing = money === "budget" && !(Number(budgetTotal) > 0);
  const figuresMissing = figuresChoice === "custom" && chosenFigures.length === 0;
  const companyMissing = company === "named" && namedEmails.length === 0;
  // B2077 — every typed answer rides in the session draft, so a reload or
  // the browser's Back keeps it. `set` trusts only the types it expects: a
  // draft is this tab's own sessionStorage, but a stale shape from an older
  // build must not crash the flow.
  const { step, reset } = useStep(STEPS, {
    flowId: `newTrip:${username}`,
    draft: {
      get: () => ({
        title, start, end, visibility, accent, accentSkipped, tagline, taglineSkipped, intro, introSkipped,
        rates, ratesSkipped, money, budgetTotal, budgetCurrency, languages, languageTitles, showSubtitles,
        languageSubtitles, figuresChoice, chosenFigures, company, namedEmails, teaser,
      }),
      set: (d) => {
        const str = (v: unknown, set: (s: string) => void) => typeof v === "string" && set(v);
        const bool = (v: unknown, set: (b: boolean) => void) => typeof v === "boolean" && set(v);
        const rec = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, string>) : null);
        const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : null);
        str(d.title, setTitle);
        // Dates the owner just asked for from their photographs beat a draft's.
        if (!initialRange) {
          str(d.start, setStart);
          str(d.end, setEnd);
        }
        if (typeof d.visibility === "string" && visibilities.includes(d.visibility)) setVisibility(d.visibility);
        str(d.accent, setAccent);
        bool(d.accentSkipped, setAccentSkipped);
        str(d.tagline, setTagline);
        bool(d.taglineSkipped, setTaglineSkipped);
        str(d.intro, setIntro);
        bool(d.introSkipped, setIntroSkipped);
        str(d.rates, setRates);
        bool(d.ratesSkipped, setRatesSkipped);
        if (d.money === "none" || d.money === "budget") setMoney(d.money);
        str(d.budgetTotal, setBudgetTotal);
        str(d.budgetCurrency, setBudgetCurrency);
        if (d.languages === "later" || d.languages === "add") setLanguages(d.languages);
        const titles = rec(d.languageTitles);
        if (titles) setLanguageTitles(titles);
        bool(d.showSubtitles, setShowSubtitles);
        const subtitles = rec(d.languageSubtitles);
        if (subtitles) setLanguageSubtitles(subtitles);
        if (d.figuresChoice === "journal" || d.figuresChoice === "none" || d.figuresChoice === "custom") setFiguresChoice(d.figuresChoice);
        const chosen = list(d.chosenFigures);
        if (chosen) setChosenFigures(chosen);
        if (d.company === "later" || d.company === "solo" || d.company === "named") setCompany(d.company);
        const named = list(d.namedEmails);
        if (named) setNamedEmails(named);
        if (typeof d.teaser === "boolean") setTeaser(d.teaser);
      },
    },
  });
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const namedContacts = contacts.filter((c) => namedEmails.includes(c.email));
  // "these people" is *offered*, never switched to for them — spec, and
  // Codex's own finding: naming somebody with a figure must never silently
  // change what was already chosen.
  const namedFigures = figures.filter((f) => f.person && namedEmails.includes(f.person));
  const namedFigureIds = namedFigures.map((f) => f.id);

  /** Named beside the primary when it is disabled — review point 3: a
   *  disabled button that says nothing about *why* is the same complaint
   *  B1901 already fixed for the dates on step one. */
  const disabledReason = budgetMissing
    ? t("studio.newTrip.rest.disabled.budget")
    : figuresMissing
      ? t("studio.newTrip.rest.disabled.figures")
      : companyMissing
        ? t("studio.newTrip.rest.disabled.company")
        : undefined;

  const [restPressed, setRestPressed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [overlapWith, setOverlapWith] = useState<ExistingTripSummary | null>(null);

  const today = new Date().toISOString().slice(0, 10);

  /** The wire shape `figuresMode` takes — the same `tripFigures` union
   *  `lib/tripWrite.ts` validates against. */
  function figuresModeWire(): { mode: "off" } | { mode: "journal" } | { mode: "custom"; figures: string[] } {
    if (figuresChoice === "none") return { mode: "off" };
    if (figuresChoice === "custom") return { mode: "custom", figures: chosenFigures };
    return { mode: "journal" };
  }

  /** Only the languages that actually got a title (or, behind "Subtitles
   *  too", a subtitle) — a language left empty is deferred, not refused
   *  (spec). */
  function translationsWire(): Record<string, { title?: string; tagline?: string }> | typeof SKIP {
    if (languages === "later") return SKIP;
    const out: Record<string, { title?: string; tagline?: string }> = {};
    for (const locale of otherLocales) {
      const title = languageTitles[locale]?.trim();
      const tagline = showSubtitles ? languageSubtitles[locale]?.trim() : "";
      if (title || tagline) out[locale] = { ...(title ? { title } : {}), ...(tagline ? { tagline } : {}) };
    }
    return Object.keys(out).length > 0 ? out : SKIP;
  }

  async function commit() {
    setBusy(true);
    setWriteError(null);
    const url = `/api/helper/${encodeURIComponent(username)}/trip`;
    const payload = {
      title,
      start,
      end,
      visibility,
      accent: accentSkipped ? SKIP : accent || SKIP,
      tagline: taglineSkipped ? SKIP : tagline || SKIP,
      intro: introSkipped ? SKIP : intro || SKIP,
      rates: ratesSkipped ? SKIP : rates || SKIP,
      costsBudget:
        money === "budget" && budgetTotal.trim()
          ? { total: Number(budgetTotal), currency: budgetCurrency }
          : SKIP,
      ...(otherLocales.length > 0 ? { translations: translationsWire() } : {}),
      figuresMode: figuresModeWire(),
      company,
      ...(company === "named" ? { namedPeople: namedContacts } : {}),
      // "Show nothing" is the default and sends no field at all (B2185)
      // — only the explicit opt-in reaches the wire.
      ...(needsTeaser && teaser ? { teaser: true } : {}),
    };
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; id?: string } | null;
      if (!res.ok || !json?.ok || !json.id) {
        setWriteError(t("studio.newTrip.writeFailed.message"));
        setOutcome("writeFailed");
        return;
      }
      setCreatedId(json.id);
      setOutcome("done");
      reset();
    } catch {
      // A network error (offline), not a rejection the server sent — B2330
      // queues the write itself rather than losing it, same reasoning as
      // AddDayFlow's day.new. This route has no id collision check to dedupe
      // a retried success against (unlike day.new's 409 `date_has_day`): a
      // response genuinely lost after the server had already written the
      // trip would replay into a second, `-2`-suffixed trip. That is the
      // same narrow window every intent here shares (the request never left
      // in the first place, or its answer never arrived) — a gap in this
      // route's own idempotency, not something the outbox can close without
      // a server-side change out of this wave's scope.
      if (hasOutbox()) {
        const store = openOutboxStore();
        await store.add(newIntent({ user: username, kind: "trip.new", method: "POST", url, body: payload }));
        setOutcome("queued");
        // Not `reset()` here — it does a soft `router.replace`, which fails
        // offline the same way AddDayFlow's own queued branch explains.
        return;
      }
      setWriteError(t("studio.newTrip.writeFailed.message"));
      setOutcome("writeFailed");
    } finally {
      setBusy(false);
    }
  }

  /**
   * "Create trip". Checks the overlapping-dates notice
   * (T3!) before anything is written; see the component doc comment above
   * for why this happens before the POST rather than after it.
   */
  function pressMakeThisTrip() {
    const overlap = existingTrips.find(
      (candidate) => candidate.status === "current" && start <= today && today <= end,
    );
    if (overlap) {
      setOverlapWith(overlap);
      setOutcome("overlap");
      return;
    }
    commit();
  }

  const titleMissing = titleLeft && !title.trim();
  const endBeforeStart = Boolean(start && end && end < start);

  const whoKey = visibility === "public" ? "public" : visibility === "guest" ? "guest" : "private";
  const onTrip = company === "named" && namedContacts.length > 0;

  return (
    <StepBody step={step}>

      {!outcome && (
        <div className="mt-4">
          {/* B1900 — the page's own <h1> already reads "A new trip"; this
              screen has no heading of its own. */}
          <p className="mt-2 text-sm text-ink-body">{t("studio.newTrip.gather1.lede")}</p>

          <label className="mt-4 block text-sm font-semibold text-ink-strong">
            {t("studio.newTrip.gather1.titleLabel")}
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => setTitleLeft(true)}
              placeholder={t("studio.newTrip.gather1.titlePlaceholder")}
              aria-invalid={titleMissing || undefined}
              aria-describedby={titleMissing ? "new-trip-title-error" : undefined}
              className={`mt-1 block min-h-11 w-full rounded-xl border bg-surface-base px-3 text-sm text-ink-body ${titleMissing ? "border-coral-600" : "border-line-strong"}`}
            />
          </label>
          {titleMissing && (
            <p id="new-trip-title-error" role="alert" className="mt-1.5 text-sm text-coral-600">
              {t("studio.newTrip.gather1.titleNeeded")}
            </p>
          )}
          {/* B2167 — one grid, two taps: the first is the first day, the
              second the last. B1901's message still sits under the last-day
              field, for a range typed backwards. */}
          <DateField
            range={{
              start,
              end,
              onChange: (first, last) => {
                setStart(first);
                setEnd(last);
              },
              startLabel: t("studio.newTrip.gather1.startLabel"),
              endLabel: t("studio.newTrip.gather1.endLabel"),
              endError: endBeforeStart ? t("studio.newTrip.gather1.endBeforeStart") : undefined,
            }}
          />
          {initialRange && initialRange.photos > 0 && (
            <p data-from-photos className="mt-2 text-sm text-ink-secondary">
              {tn("studio.newTrip.fromPhotos.summary", initialRange.photos, {
                count: String(initialRange.photos),
                range: `${formatShortDate(initialRange.start)} – ${formatShortDate(initialRange.end)}`,
              })}
            </p>
          )}

          {/* B2187 — who can read it, answered already: the current choice in
              plain words, the three choices one tap away. Private is the
              default whatever the journal's own default is. */}
          <details data-who-can-read className="mt-4 rounded-xl border border-line-strong bg-surface-raised px-4 py-3">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3">
              <span>
                <span className="block text-sm font-semibold text-ink-strong">{t("studio.newTrip.gather1.visibilityHeading")}</span>
                <span className="block text-sm text-ink-body">
                  {t(onTrip && whoKey === "private" ? "studio.newTrip.who.privateNamed" : (`studio.newTrip.who.${whoKey}` as TranslationKey))}
                </span>
              </span>
              <span className="text-sm font-semibold text-ink-body underline underline-offset-2">{t("studio.newTrip.who.change")}</span>
            </summary>
            <div className="mt-3 flex flex-col gap-2">
              {visibilities.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setVisibility(v)}
                  aria-pressed={visibility === v}
                  className={`rounded-xl border px-4 py-3 text-left ${
                    visibility === v ? "border-action-strong bg-surface-subtle" : "border-line-strong bg-surface-raised"
                  }`}
                >
                  <span className="block text-sm font-semibold text-ink-strong">
                    {t(`studio.visibility.${v}.title` as TranslationKey)}
                  </span>
                  <span className="block text-xs text-ink-secondary">
                    {t(`studio.visibility.${v}.description` as TranslationKey)}
                  </span>
                </button>
              ))}
            </div>
          </details>
          <p className="mt-2 text-sm text-ink-secondary">
            {t(`studio.newTrip.who.line.${whoKey}` as TranslationKey)}
            {onTrip && ` ${t("studio.newTrip.who.namedDrafts")}`}
          </p>

          {/* B2187 — everything else, collapsed, fed from the same state.
              Never opened, every answer stays at its default and the four
              helper fields still go out as "none". */}
          <details data-more-settings className="mt-4 rounded-xl border border-line-strong bg-surface-raised px-4 py-3">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3">
              <span>
                <span className="block text-sm font-semibold text-ink-strong">{t("studio.newTrip.more.label")}</span>
                <span className="block text-sm text-ink-secondary">{t("studio.newTrip.more.hint")}</span>
              </span>
              <span aria-hidden className="text-ink-secondary">›</span>
            </summary>
            <p className="mt-3 text-sm text-ink-body">{t("studio.newTrip.rest.lede")}</p>

          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">
              {t("studio.newTrip.gather2.accentLabel")}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {accents.map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => {
                    setAccent(a);
                    setAccentSkipped(false);
                  }}
                  aria-pressed={accent === a && !accentSkipped}
                  className={`h-9 w-9 rounded-full border-2 ${ACCENT_SWATCH[a] ?? "bg-surface-subtle"} ${
                    accent === a && !accentSkipped ? "border-ink-strong" : "border-transparent"
                  }`}
                  aria-label={a}
                />
              ))}
              <button
                type="button"
                onClick={() => {
                  setAccentSkipped(true);
                  setAccent("");
                }}
                className={`rounded-full border px-3 py-1 text-sm font-semibold ${
                  accentSkipped ? "border-ink-strong text-ink-strong" : "border-line-strong text-ink-secondary"
                }`}
              >
                {accentSkipped ? t("studio.newTrip.gather2.skipped") : t("studio.newTrip.gather2.skip")}
              </button>
            </div>
          </div>

          <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-ink-secondary">
            {t("studio.newTrip.gather2.taglineLabel")}
            <div className="mt-1 flex items-center gap-2">
              <input
                type="text"
                value={tagline}
                disabled={taglineSkipped}
                onChange={(e) => {
                  setTagline(e.target.value);
                  setTaglineSkipped(false);
                }}
                placeholder={t("studio.newTrip.gather2.taglinePlaceholder")}
                className="block min-h-11 w-full rounded-xl border border-line-strong bg-surface-base px-3 text-sm text-ink-body disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => {
                  setTaglineSkipped((v) => !v);
                  if (!taglineSkipped) setTagline("");
                }}
                className="shrink-0 text-sm font-semibold text-ink-body underline underline-offset-2"
              >
                {taglineSkipped ? t("studio.newTrip.gather2.skipped") : t("studio.newTrip.gather2.skip")}
              </button>
            </div>
          </label>

          <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-ink-secondary">
            {t("studio.newTrip.gather2.introLabel")}
            <textarea
              value={intro}
              disabled={introSkipped}
              onChange={(e) => {
                setIntro(e.target.value);
                setIntroSkipped(false);
              }}
              className="mt-1 block min-h-20 w-full rounded-xl border border-line-strong bg-surface-base px-3 py-2 text-sm text-ink-body disabled:opacity-50"
            />
            <button
              type="button"
              onClick={() => {
                setIntroSkipped((v) => !v);
                if (!introSkipped) setIntro("");
              }}
              className="mt-1 text-sm font-semibold text-ink-body underline underline-offset-2"
            >
              {introSkipped ? t("studio.newTrip.gather2.skipped") : t("studio.newTrip.gather2.skip")}
            </button>
          </label>

          <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-ink-secondary">
            {t("studio.newTrip.gather2.ratesLabel")}
            {/* B2143 — the journal's own list, never free text; the base is
                never "other". Still sent as the comma list the route reads. */}
            {currencies.length > 1 ? (
              <div className="mt-1 flex flex-wrap items-center gap-2 normal-case tracking-normal">
                {currencies.slice(1).map((code) => {
                  const chosen = rates.split(",").map((c) => c.trim()).filter(Boolean);
                  const on = chosen.includes(code);
                  return (
                    <Chip
                      key={code}
                      label={code}
                      active={on}
                      onClick={() => {
                        setRates((on ? chosen.filter((c) => c !== code) : [...chosen, code]).join(", "));
                        setRatesSkipped(false);
                      }}
                    />
                  );
                })}
                <button
                  type="button"
                  onClick={() => {
                    setRatesSkipped((v) => !v);
                    if (!ratesSkipped) setRates("");
                  }}
                  className="shrink-0 text-sm font-semibold text-ink-body underline underline-offset-2"
                >
                  {ratesSkipped ? t("studio.newTrip.gather2.skipped") : t("studio.newTrip.gather2.skip")}
                </button>
              </div>
            ) : (
              <span className="mt-1 block text-sm font-normal normal-case tracking-normal text-ink-secondary">
                {t("studio.newTrip.gather2.ratesNone")}
              </span>
            )}
          </label>

          <div className="mt-4 rounded-xl border border-line-strong bg-surface-subtle px-4 py-3 text-sm text-ink-body">
            {t("studio.newTrip.gather2.skipNotice")}
          </div>

          <RestCard label={t("studio.newTrip.rest.money.label")}>
            <Chip label={t("studio.newTrip.rest.money.none")} active={money === "none"} onClick={() => setMoney("none")} />
            <Chip label={t("studio.newTrip.rest.money.budget")} active={money === "budget"} onClick={() => setMoney("budget")} />
          </RestCard>
          {money === "budget" && (
            <div className="-mt-2 mb-2 rounded-xl border border-line-strong bg-surface-raised p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">
                {t("studio.newTrip.rest.money.budgetLabel", { currency: budgetCurrency })}
              </p>
              <div className="mt-2 flex gap-2">
                <input
                  type="number"
                  min="0"
                  inputMode="decimal"
                  value={budgetTotal}
                  onChange={(e) => setBudgetTotal(e.target.value)}
                  className="min-h-11 flex-1 rounded-xl border border-line-strong bg-surface-base px-3 text-sm text-ink-body"
                />
                <select
                  value={budgetCurrency}
                  onChange={(e) => setBudgetCurrency(e.target.value)}
                  aria-label={t("studio.newTrip.rest.money.currencyLabel")}
                  className="min-h-11 w-24 rounded-xl border border-line-strong bg-surface-base px-3 text-sm text-ink-body"
                >
                  {currencies.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
              </div>
              {(() => {
                const nights = daysBetween(start, end);
                const total = Number(budgetTotal);
                return budgetTotal.trim() && Number.isFinite(total) && total > 0 && nights > 0 ? (
                  <p className="mt-2 text-xs text-ink-secondary">
                    {tn("studio.newTrip.rest.money.perDay", nights, {
                      amount: new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(total / nights),
                      currency: budgetCurrency,
                      days: String(nights),
                    })}
                  </p>
                ) : null;
              })()}
            </div>
          )}

          {otherLocales.length > 0 && (
            <RestCard
              label={t("studio.newTrip.rest.languages.label")}
              // Review point 4: the fallback is true whether or not the
              // panel is expanded, so the collapsed card says it too.
              note={t("studio.newTrip.rest.languages.fallback", {
                title: title || t("studio.newTrip.decide.untitled"),
              })}
            >
              <Chip
                label={t("studio.newTrip.rest.languages.later", { locale: langName(defaultLocale) })}
                active={languages === "later"}
                onClick={() => setLanguages("later")}
              />
              <Chip label={t("studio.newTrip.rest.languages.add")} active={languages === "add"} onClick={() => setLanguages("add")} />
            </RestCard>
          )}
          {languages === "add" && otherLocales.length > 0 && (
            <div className="-mt-2 mb-2 rounded-xl border border-line-strong bg-surface-raised p-4">
              {otherLocales.map((locale) => (
                <div key={locale} className="mt-3 first:mt-0">
                  <label className="block text-xs font-semibold uppercase tracking-wide text-ink-secondary">
                    {langName(locale)}
                  </label>
                  {/* Review point 4: persistent text, not a placeholder that
                      vanishes the moment somebody starts typing. */}
                  <p className="mt-1 text-xs text-ink-secondary">
                    {t("studio.newTrip.rest.languages.fallback", { title: title || t("studio.newTrip.decide.untitled") })}
                  </p>
                  <input
                    type="text"
                    value={languageTitles[locale] ?? ""}
                    onChange={(e) => setLanguageTitles((prev) => ({ ...prev, [locale]: e.target.value }))}
                    className="mt-1 block min-h-11 w-full rounded-xl border border-line-strong bg-surface-base px-3 text-sm text-ink-body"
                  />
                  {showSubtitles && (
                    <input
                      type="text"
                      value={languageSubtitles[locale] ?? ""}
                      onChange={(e) => setLanguageSubtitles((prev) => ({ ...prev, [locale]: e.target.value }))}
                      placeholder={t("studio.newTrip.rest.languages.subtitlePlaceholder")}
                      className="mt-1 block min-h-11 w-full rounded-xl border border-line-strong bg-surface-base px-3 text-sm text-ink-body"
                    />
                  )}
                </div>
              ))}
              {!showSubtitles && (
                <button
                  type="button"
                  onClick={() => setShowSubtitles(true)}
                  className="mt-3 min-h-11 text-xs font-semibold text-ink-body underline underline-offset-2"
                >
                  {t("studio.newTrip.rest.languages.subtitlesToo")}
                </button>
              )}
              <p className="mt-2 text-xs text-ink-secondary">{t("studio.newTrip.rest.languages.deferredNote")}</p>
            </div>
          )}

          <RestCard label={t("studio.newTrip.rest.figures.label")}>
            <Chip label={t("studio.newTrip.rest.figures.journal")} active={figuresChoice === "journal"} onClick={() => setFiguresChoice("journal")} />
            <Chip label={t("studio.newTrip.rest.figures.none")} active={figuresChoice === "none"} onClick={() => setFiguresChoice("none")} />
            <Chip label={t("studio.newTrip.rest.figures.choose")} active={figuresChoice === "custom"} onClick={() => setFiguresChoice("custom")} />
          </RestCard>
          {figuresChoice === "journal" && journalFigures.length > 0 && (
            <div className="-mt-2 mb-2">
              <button
                type="button"
                onClick={() => setShowJournalSet((v) => !v)}
                className="min-h-11 text-xs font-semibold text-ink-body underline underline-offset-2"
              >
                {t("studio.newTrip.rest.figures.seeSet")}
              </button>
              {/* Review point 6: the words "the journal's own" drawn, not
                  just asserted. */}
              {showJournalSet && (
                <div className="mt-2 flex flex-wrap gap-2 rounded-xl border border-line-strong bg-surface-raised p-3">
                  {/* eslint-disable-next-line @next/next/no-img-element -- see FigureTile's own note. */}
                  <img
                    src={previewSrc(username, { party: journalFigures }, 96)}
                    alt=""
                    width={96}
                    height={96}
                    className="h-24"
                  />
                </div>
              )}
            </div>
          )}
          {/* Review point 5: "these people" lists exactly what would walk,
              drawn, before it is ever tapped — offered, never switched to. */}
          {company === "named" && namedFigures.length > 0 && (
            <div className="-mt-2 mb-2 rounded-xl border border-line-strong bg-surface-raised p-3">
              <div className="flex flex-wrap items-center gap-2">
                {namedFigures.map((f) => (
                  <FigureTile key={f.id} username={username} figure={f} label={f.name ?? f.id} />
                ))}
                <Chip
                  label={t("studio.newTrip.rest.figures.theseNamed")}
                  active={
                    figuresChoice === "custom" &&
                    chosenFigures.length === namedFigureIds.length &&
                    namedFigureIds.every((id) => chosenFigures.includes(id))
                  }
                  onClick={() => {
                    setFiguresChoice("custom");
                    setChosenFigures(namedFigureIds);
                  }}
                />
              </div>
            </div>
          )}
          {figuresChoice === "custom" && (
            <div className="-mt-2 mb-2 rounded-xl border border-line-strong bg-surface-raised p-4">
              {figures.length === 0 ? (
                <p className="text-sm text-ink-secondary">{t("studio.newTrip.rest.figures.empty")}</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {figures.map((f) => (
                    <FigureTile
                      key={f.id}
                      username={username}
                      figure={f}
                      label={f.name ?? f.id}
                      active={chosenFigures.includes(f.id)}
                      onClick={() =>
                        setChosenFigures((prev) => (prev.includes(f.id) ? prev.filter((id) => id !== f.id) : [...prev, f.id]))
                      }
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          <RestCard label={t("studio.newTrip.rest.company.label")}>
            <Chip label={t("studio.newTrip.rest.company.later")} active={company === "later"} onClick={() => setCompany("later")} />
            <Chip label={t("studio.newTrip.rest.company.solo")} active={company === "solo"} onClick={() => setCompany("solo")} />
            <Chip label={t("studio.newTrip.rest.company.named")} active={company === "named"} onClick={() => setCompany("named")} />
          </RestCard>
          {company === "named" && (
            <div className="-mt-2 mb-2 rounded-xl border border-line-strong bg-surface-raised p-4">
              {contacts.length === 0 ? (
                <p className="text-sm text-ink-secondary">{t("studio.newTrip.rest.company.empty")}</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {contacts.map((c) => (
                    <Chip
                      key={c.email}
                      label={c.name}
                      active={namedEmails.includes(c.email)}
                      onClick={() =>
                        setNamedEmails((prev) => (prev.includes(c.email) ? prev.filter((e) => e !== c.email) : [...prev, c.email]))
                      }
                    />
                  ))}
                </div>
              )}
              <p className="mt-2 text-xs text-ink-secondary">{t("studio.newTrip.rest.company.namedNote")}</p>
            </div>
          )}

          {needsTeaser && (
            <RestCard
              label={t("studio.newTrip.rest.teaser.label")}
              note={t(teaser ? "studio.newTrip.rest.teaser.noteShown" : "studio.newTrip.rest.teaser.note")}
            >
              <Chip label={t("studio.newTrip.rest.teaser.show")} active={teaser === true} onClick={() => setTeaser(true)} />
              <Chip label={t("studio.newTrip.rest.teaser.hide")} active={teaser === false} onClick={() => setTeaser(false)} />
            </RestCard>
          )}

          </details>

          <div className="mt-4">
            {/* B2137: what is still missing reads as a hint until the
                primary is pressed; only a press makes it an alert. */}
            <StepPrimary
              disabled={!title.trim() || !start || !end || end < start}
              busy={busy}
              busyLabel={t("studio.newTrip.createBusy")}
              onClick={() => (disabledReason ? setRestPressed(true) : pressMakeThisTrip())}
              label={t("studio.newTrip.create")}
              tone="bg-yellow-400 text-yellow-950 hover:bg-yellow-300"
            />
            {disabledReason &&
              (restPressed ? (
                <p role="alert" className="text-sm text-coral-600">{disabledReason}</p>
              ) : (
                <p className="text-sm text-ink-secondary">{disabledReason}</p>
              ))}
          </div>
          <p className="mt-3 text-sm text-ink-secondary">{t("studio.newTrip.decide.currentNotice")}</p>
          {photoRun && (photoRun.start !== initialRange?.start || photoRun.end !== initialRange?.end) && (
            <Link
              href={`/${username}/studio/trip/new?start=${photoRun.start}&end=${photoRun.end}`}
              className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-ink-body underline underline-offset-2"
            >
              {t("studio.newTrip.fromPhotos.link")}
            </Link>
          )}
          <SubmitError message={writeError} />
        </div>
      )}

      {outcome === "overlap" && overlapWith && (
        <div className="mt-4">
          <div className="rounded-xl border border-coral-300 bg-coral-50 px-4 py-3 text-sm text-ink-body">
            <p className="font-semibold text-ink-strong">
              {t("studio.newTrip.overlap.banner", { other: overlapWith.title, date: formatLongDate(today) })}
            </p>
          </div>
          <p className="mt-3 text-sm text-ink-body">{t("studio.newTrip.overlap.explain")}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setOutcome(null);
              }}
              className="min-h-11 rounded-full border border-line-strong px-5 text-base font-semibold text-ink-body hover:bg-surface-subtle"
            >
              {t("studio.newTrip.overlap.changeDates")}
            </button>
            <StepPrimary
              busy={busy}
              busyLabel={t("studio.newTrip.createBusy")}
              onClick={commit}
              label={t("studio.newTrip.overlap.thatIsFine")}
            />
          </div>
          <SubmitError message={writeError} />
        </div>
      )}

      {outcome === "done" && createdId && (
        <>
          <DoneScreen
            username={username}
            done={t("studio.newTrip.done.banner", { title: title || t("studio.newTrip.decide.untitled") })}
            next={[
              {
                title: t("studio.newTrip.done.firstDay.title"),
                href: `/${username}/studio/day/new?trip=${encodeURIComponent(createdId)}`,
                label: t("studio.newTrip.done.addFirstDay"),
              },
              // B2187 — one way to let somebody in, said before the tap.
              // People named on the trip are on it already and are invited
              // from People; otherwise a journal invite, which only opens a
              // trip that is not private — so a private trip offers none.
              ...(onTrip
                ? [
                    {
                      title: t("studio.newTrip.done.invite.title", { names: namedContacts.map((c) => c.name).join(", ") }),
                      body: t("studio.newTrip.done.invite.note"),
                      href: `/${username}/studio/people`,
                      label: t("studio.newTrip.done.invite.cta"),
                    },
                  ]
                : visibility !== "private"
                  ? [
                      {
                        title: t("studio.newTrip.done.readAlong.title"),
                        body: t("studio.newTrip.done.readAlong.body"),
                        href: `/${username}/studio/readers#invite`,
                        label: t("studio.newTrip.done.readAlong.cta"),
                      },
                    ]
                  : []),
            ] as [DoneNext] | [DoneNext, DoneNext]}
          />
          {whatsappAvailable && <p className="mt-4 text-xs text-ink-secondary">{t("studio.newTrip.done.whatsappHint")}</p>}
        </>
      )}

      {outcome === "queued" && (
        <div className="mt-4">
          <DoneScreen username={username} done={t("studio.day.queued.done")} />
          <p className="mt-2 text-sm text-ink-secondary">{t("studio.day.queued.detail")}</p>
        </div>
      )}

      {outcome === "writeFailed" && (
        <div className="mt-4">
          <SubmitError message={`${t("studio.newTrip.writeFailed.banner")} ${writeError ?? ""}`} />
          <StepPrimary onClick={() => setOutcome(null)} label={t("studio.newTrip.writeFailed.backToCheck")} />
        </div>
      )}
    </StepBody>
  );
}

/** Whole days a trip spans, inclusive of both ends — "the whole trip
 *  averaged over n days" (spec). 0 when the dates cannot be parsed, so the
 *  per-day line simply does not render rather than divide by zero. */
function daysBetween(start: string, end: string): number {
  const a = Date.parse(start);
  const b = Date.parse(end);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 0;
  return Math.round((b - a) / (24 * 60 * 60 * 1000)) + 1;
}
