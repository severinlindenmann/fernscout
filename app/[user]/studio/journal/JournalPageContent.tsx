"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/components/LocaleProvider";
import StepPrimary from "@/components/studio/StepPrimary";
import SubmitError from "@/components/studio/SubmitError";
import { LOCALE_LABEL, MAINTAINED_LOCALES } from "@/lib/i18n";
import { TELL_BY, type TellBy } from "@/lib/studio/speak";

const EYEBROW = "block font-mono text-[11px] font-medium uppercase tracking-[.06em] text-ink-secondary";
const FIELD_INPUT =
  "mt-1.5 block min-h-11 w-full rounded-xl border border-line-prominent bg-surface-raised px-3 py-2.5 text-base text-ink-strong";
const HINT = "mt-1.5 text-sm leading-6 text-ink-secondary";

/** "Swiss Franc" for CHF, in the page's language; the code when the runtime
 *  has no name for it. Only for search and a tooltip. */
function currencyName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: "currency" }).of(code) ?? code;
  } catch {
    return code;
  }
}
/** A radio or checkbox drawn as a pill: the input stays in the pill (visually
 *  hidden, still focusable and announced), the pill wears its state. */
const PILL =
  "inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full border border-line-strong bg-surface-raised px-4 text-sm font-semibold text-ink-strong has-[:checked]:border-action-strong has-[:checked]:bg-action-strong has-[:checked]:text-on-action has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2";

/** The journal's own description, for the page that edits it — B619, moved
 * from `/[user]/me/MePageContent.tsx` by B2017. Owner only, and resolved on
 * the server like every other studio panel. */
export type JournalPanel = {
  title: string;
  /** `""` when the journal has none; clearing the box removes the key. */
  tagline: string;
  /** Shown, never edited. See `JournalPageContent`. */
  email: string;
  /** The rest of `JOURNAL_PROFILE_FIELDS` (`lib/journals.ts`), minus
   *  `manualRates` (out of scope, no form in the B852 mockup this follows)
   *  and `baseCurrency` (never writable — see `JournalPageContent`). Built
   *  server-side from `journalProfile()`, the same function `GET
   *  /api/v1/{user}/config` reads, so this panel can never show a field
   *  that call would disagree about — B852. */
  visibility: "public" | "guest";
  units: "metric" | "imperial";
  locales: string[];
  defaultLocale: string;
  displayCurrencies: string[];
  /** `""` when none is set. Read-only here — B1653; see the panel that shows
   *  it. Still writable via an agent's `PATCH /api/v1/{user}/config`. */
  ownerTel: string;
  /** Read-only — shown so the refusal on the screen names the value rather
   *  than only the rule. */
  baseCurrency: string;
};

/** One trip's evening-reminder switch — B2171. Only trips not yet over. */
export type ReminderRow = { id: string; title: string; on: boolean };

/**
 * `/[user]/studio/journal` — journal settings, one page with one Save — B2074.
 *
 * Moved whole from `/[user]/me` by B2017 (B619, widened by B852), where it
 * had grown two identical "Save" buttons 1,300px apart, each saving only its
 * own half, and a bare "Advertise" chip under the second. Now every field is
 * one form and one press: the bar's Save names how many things moved,
 * disabled until something did, and sends only what moved in one `PATCH
 * /api/web/{user}` — `setJournalProfile` writes `config.json` once, whole or
 * not at all, so there is nothing to gain from saving halves.
 *
 * `/api/web/{user}` rather than `/api/v1/{user}/config`: that one takes a
 * bearer token and this is a cookie session, which are deliberately not
 * interchangeable. The route's own comment carries the reasoning.
 *
 * **Read-only, and hint lines rather than fields:** the email (it decides who
 * can obtain a write token, so a stolen cookie must not move the journal to
 * another mailbox); the owner's WhatsApp (proof-only since B1654 — set by
 * phone verification, never by a bare write; B1653); and `baseCurrency`, the
 * one field `setJournalProfile` refuses outright, since a bare amount already
 * written *is* an amount in it. `manualRates` stays API-only (scope, not
 * policy).
 *
 * **Advertise** is `visibility` — "public" is listed on this server's
 * landing page, sitemap and `/documentation.txt`, "guest" is not. A labelled
 * switch with its consequence beside it; it rides the same Save, which is the
 * deliberate second press it used to get from its own confirmation.
 *
 * **Evening reminder** — B2171, one switch per trip not yet over, riding the
 * same Save and counted in it. Each trip that moved is one `PATCH
 * /api/web/{user}/trips/{trip}/reminder` (the setting lives on the trip, not
 * the journal), after the journal's own PATCH when there is one.
 */
export default function JournalPageContent({
  username,
  journal,
  knownCurrencies,
  reminders,
  tellBy,
}: {
  username: string;
  journal: JournalPanel;
  /** `knownCurrencies()` (`lib/rates.ts`) — every code this instance's rates
   *  table prices. The picker offers these and nothing typed (B2143). */
  knownCurrencies: string[];
  reminders: ReminderRow[];
  /** B2194 — "How you tell a day", only when transcription is on; absent
   *  (undefined) otherwise. `tellBy: null` is "never asked". */
  tellBy?: { current: TellBy | null };
}) {
  const { t, tn, locale } = useI18n();
  const router = useRouter();
  const [title, setTitle] = useState(journal.title);
  const [tagline, setTagline] = useState(journal.tagline);
  const [units, setUnits] = useState(journal.units);
  const [defaultLocale, setDefaultLocale] = useState(journal.defaultLocale);
  // Every maintained locale but the default — `defaultLocale` is never one
  // of its own extras, the same split `SignupWizard` draws.
  const [extraLocales, setExtraLocales] = useState<string[]>(() =>
    journal.locales.filter((code) => code !== journal.defaultLocale),
  );
  const [currencyList, setCurrencyList] = useState(journal.displayCurrencies);
  const [currencySearch, setCurrencySearch] = useState("");
  const [listed, setListed] = useState(journal.visibility === "public");
  const [reminderOn, setReminderOn] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(reminders.map((row) => [row.id, row.on])),
  );
  const [tellByChoice, setTellByChoice] = useState<TellBy | null>(tellBy?.current ?? null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const extrasWere = journal.locales.filter((code) => code !== journal.defaultLocale);

  /** Only what moved, so an untouched field is never rewritten — and the
   *  count on the Save is this object's size. */
  const patch: Record<string, unknown> = {};
  if (title.trim() !== journal.title) patch.title = title.trim();
  if (tagline.trim() !== journal.tagline) patch.tagline = tagline.trim();
  if (units !== journal.units) patch.units = units;
  if (
    defaultLocale !== journal.defaultLocale ||
    extraLocales.length !== extrasWere.length ||
    extraLocales.some((code) => !extrasWere.includes(code))
  ) {
    // v2 has no separate `defaultLocale`: the first entry of `locales` IS
    // the default.
    patch.locales = [defaultLocale, ...extraLocales];
  }
  // Base first, always in — the rule `setJournalProfile` enforces.
  const baseFirst = (list: string[]) => [journal.baseCurrency, ...list.filter((c) => c !== journal.baseCurrency)];
  if (baseFirst(currencyList).join(", ") !== baseFirst(journal.displayCurrencies).join(", "))
    patch.displayCurrencies = baseFirst(currencyList);
  if (listed !== (journal.visibility === "public")) patch.visibility = listed ? "public" : "guest";
  const reminderMoves = reminders.filter((row) => reminderOn[row.id] !== row.on);
  const tellByMoved = !!tellBy && tellByChoice !== null && tellByChoice !== tellBy.current;
  const count = Object.keys(patch).length + reminderMoves.length + (tellByMoved ? 1 : 0);
  // A title cannot be cleared — `setJournalProfile` refuses it.
  const titleMissing = title.trim() === "";

  // The same swap `SignupWizard` makes (B838): choosing a new default drops
  // it from the extras, since it cannot be both.
  function chooseDefaultLocale(code: string) {
    setDefaultLocale(code);
    setExtraLocales((prev) => prev.filter((c) => c !== code));
  }

  async function save() {
    setBusy(true);
    setSaved(false);
    setError(null);
    const writes = [
      ...(Object.keys(patch).length > 0 ? [{ url: `/api/web/${encodeURIComponent(username)}`, body: patch }] : []),
      ...reminderMoves.map((row) => ({
        url: `/api/web/${encodeURIComponent(username)}/trips/${encodeURIComponent(row.id)}/reminder`,
        body: { enabled: reminderOn[row.id] },
      })),
      ...(tellByMoved ? [{ url: `/api/web/${encodeURIComponent(username)}/studio/tell-by`, body: { tellBy: tellByChoice } }] : []),
    ];
    for (const write of writes) {
      const response = await fetch(write.url, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(write.body),
      }).catch(() => null);
      if (!response?.ok) {
        const said = (await response?.json().catch(() => null)) as { message?: string } | null;
        setBusy(false);
        setError(said?.message ?? t("me.journalFailed"));
        // What did go through is on disk; reading again shows it as saved.
        router.refresh();
        return;
      }
    }
    setBusy(false);
    setSaved(true);
    // The title is in the header of every page, so the whole tree reads
    // itself again; once the new values arrive the count is 0 and "Saved."
    // shows.
    router.refresh();
  }

  return (
    <div data-journal-settings className="mt-6 space-y-6">
      <label className="block">
        <span className={EYEBROW}>{t("me.journalName")}</span>
        <input
          type="text"
          value={title}
          maxLength={120}
          aria-invalid={titleMissing}
          onChange={(event) => setTitle(event.target.value)}
          className={titleMissing ? FIELD_INPUT.replace("border-line-prominent", "border-coral-600") : FIELD_INPUT}
        />
        {titleMissing && (
          <span role="alert" className="mt-1.5 block text-sm text-coral-600">
            {t("me.journalNameNeeded")}
          </span>
        )}
      </label>

      <label className="block">
        <span className={EYEBROW}>{t("me.journalTagline")}</span>
        <input
          type="text"
          value={tagline}
          maxLength={200}
          onChange={(event) => setTagline(event.target.value)}
          className={FIELD_INPUT}
        />
      </label>

      <fieldset>
        <legend className={EYEBROW}>{t("me.journalUnits")}</legend>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {(["metric", "imperial"] as const).map((value) => (
            <label key={value} className={PILL}>
              <input
                type="radio"
                name={`${username}-journal-units`}
                className="sr-only"
                checked={units === value}
                onChange={() => setUnits(value)}
              />
              {t(value === "metric" ? "me.journalUnitsMetric" : "me.journalUnitsImperial")}
            </label>
          ))}
        </div>
      </fieldset>

      {/* Same two questions `SignupWizard` asks at signup (B838), with the
          same hints, verbatim — a second copy of that warning is a second
          copy to disagree with the first. */}
      <fieldset>
        <legend className={EYEBROW}>{t("me.journalWriteIn")}</legend>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {MAINTAINED_LOCALES.map((code) => (
            <label key={code} className={PILL}>
              <input
                type="radio"
                name={`${username}-journal-locale`}
                className="sr-only"
                checked={defaultLocale === code}
                onChange={() => chooseDefaultLocale(code)}
              />
              {LOCALE_LABEL[code] ?? code}
            </label>
          ))}
        </div>
        <p className={HINT}>{t("agent.localeHint")}</p>
      </fieldset>

      <fieldset>
        <legend className={EYEBROW}>{t("me.journalReadersSwitch")}</legend>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {MAINTAINED_LOCALES.filter((code) => code !== defaultLocale).map((code) => (
            <label key={code} className={PILL}>
              <input
                type="checkbox"
                className="sr-only"
                checked={extraLocales.includes(code)}
                onChange={(event) =>
                  setExtraLocales((prev) =>
                    event.target.checked ? [...prev, code] : prev.filter((c) => c !== code),
                  )
                }
              />
              {extraLocales.includes(code) && <span aria-hidden="true">✓</span>}
              {LOCALE_LABEL[code] ?? code}
            </label>
          ))}
        </div>
        <p className={HINT}>{t("agent.readerLocalesHint")}</p>
        {/* B852 — the one thing an owner considering removing a language
            needs to hear before they do it. */}
        <p className={HINT}>{t("me.journalLocalesRemoveNote")}</p>
      </fieldset>

      {/* B2143 — chips from the rates table, never free text. The base is
          pinned first and cannot be taken off; a code already chosen stays
          offered even if the table has since lost it, so it can be removed. */}
      <fieldset data-currency-picker>
        <legend className={EYEBROW}>{t("me.journalCurrencies")}</legend>
        <input
          type="search"
          value={currencySearch}
          onChange={(event) => setCurrencySearch(event.target.value)}
          placeholder={t("me.journalCurrenciesSearch")}
          aria-label={t("me.journalCurrenciesSearch")}
          className={FIELD_INPUT}
        />
        <div className="mt-2 flex flex-wrap gap-2">
          {[
            journal.baseCurrency,
            ...[...new Set([...knownCurrencies, ...currencyList])]
              .filter((code) => code !== journal.baseCurrency)
              .sort(),
          ]
            .filter((code) => {
              const q = currencySearch.trim().toLowerCase();
              return code === journal.baseCurrency || !q || code.toLowerCase().includes(q) || currencyName(code, locale).toLowerCase().includes(q);
            })
            .map((code) => {
              const base = code === journal.baseCurrency;
              const on = base || currencyList.includes(code);
              return (
                <label key={code} className={PILL} title={currencyName(code, locale)}>
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={on}
                    disabled={base}
                    onChange={(event) =>
                      setCurrencyList((prev) =>
                        event.target.checked ? [...prev, code] : prev.filter((c) => c !== code),
                      )
                    }
                  />
                  {on && <span aria-hidden="true">✓</span>}
                  {code}
                </label>
              );
            })}
        </div>
        <p className={HINT}>{t("me.journalCurrenciesHint")}</p>
        <p className={HINT}>{t("me.journalBaseCurrencyFixed", { code: journal.baseCurrency })}</p>
      </fieldset>

      <div>
        <p className={EYEBROW} id={`${username}-journal-listed-label`}>
          {t("me.journalVisibility")}
        </p>
        <div className="mt-1.5 flex items-center gap-3 rounded-2xl border border-line-strong bg-surface-raised px-4 py-3">
          <span className="min-w-0 flex-1">
            <span className="block text-base font-semibold text-ink-strong">{t("me.journalListed")}</span>
            <span className="mt-0.5 block text-sm leading-6 text-ink-secondary">{t("me.journalVisibilityHint")}</span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={listed}
            aria-labelledby={`${username}-journal-listed-label`}
            onClick={() => setListed((on) => !on)}
            className={`relative h-7 w-12 flex-none rounded-full transition-colors ${listed ? "bg-action-strong" : "bg-line-prominent"}`}
          >
            <span
              aria-hidden="true"
              className={`absolute top-1 size-5 rounded-full bg-surface-raised transition-all ${listed ? "left-6" : "left-1"}`}
            />
          </button>
        </div>
      </div>

      <div data-journal-reminders>
        <p className={EYEBROW}>{t("me.journalReminder")}</p>
        {reminders.length === 0 ? (
          <p className="mt-1.5 rounded-2xl bg-surface-subtle px-4 py-3 text-sm leading-6 text-ink-secondary">
            {t("me.journalReminderNone")}
          </p>
        ) : (
          <div className="mt-1.5 divide-y divide-line-quiet rounded-2xl border border-line-strong bg-surface-raised">
            {reminders.map((row) => {
              const on = reminderOn[row.id];
              const labelId = `${username}-reminder-${row.id}`;
              return (
                <div key={row.id} className="flex items-center gap-3 px-4 py-3">
                  <span id={labelId} className="min-w-0 flex-1 text-base font-semibold text-ink-strong">
                    {row.title}
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    aria-labelledby={labelId}
                    onClick={() => setReminderOn((prev) => ({ ...prev, [row.id]: !prev[row.id] }))}
                    className={`relative h-7 w-12 flex-none rounded-full transition-colors ${on ? "bg-action-strong" : "bg-line-prominent"}`}
                  >
                    <span
                      aria-hidden="true"
                      className={`absolute top-1 size-5 rounded-full bg-surface-raised transition-all ${on ? "left-6" : "left-1"}`}
                    />
                  </button>
                </div>
              );
            })}
          </div>
        )}
        <p className={HINT}>{t("me.journalReminderHint")}</p>
      </div>

      {tellBy && (
        <fieldset data-tell-by-setting>
          <legend className={EYEBROW}>{t("me.journalTellBy")}</legend>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {TELL_BY.map((value) => (
              <label key={value} className={PILL}>
                <input
                  type="radio"
                  name={`${username}-journal-tell-by`}
                  className="sr-only"
                  checked={tellByChoice === value}
                  onChange={() => setTellByChoice(value)}
                />
                {t(`studio.day.tellBy.${value}`)}
              </label>
            ))}
          </div>
          <p className={HINT}>{t("me.journalTellByHint")}</p>
        </fieldset>
      )}

      {/* Facts, not fields — see the module comment. */}
      <div className="space-y-1.5 border-t border-line-quiet pt-4">
        <p className="text-sm leading-6 text-ink-secondary">
          <span className="font-semibold text-ink-strong">
            {t("me.journalEmail")}: {journal.email}
          </span>{" "}
          {t("me.journalEmailNote")}
        </p>
        <p className="text-sm leading-6 text-ink-secondary">
          <span className="font-semibold text-ink-strong">
            {t("me.journalOwnerTel")}: {journal.ownerTel || t("me.journalOwnerTelNone")}
          </span>{" "}
          {t("me.journalOwnerTelHint")}
        </p>
      </div>

      <div>
        <StepPrimary
          label={count === 0 ? t("me.journalSave") : tn("edit.confirmSave.button", count, { count: String(count) })}
          busy={busy}
          busyLabel={t("edit.confirmSave.busy")}
          disabled={count === 0 || titleMissing}
          onClick={() => void save()}
          tone="bg-yellow-400 text-yellow-950 hover:bg-yellow-300"
        />
        {saved && count === 0 && (
          <p role="status" className="mt-2 text-sm text-ink-secondary">
            {t("me.journalSaved")}
          </p>
        )}
        <SubmitError message={error} />
      </div>
    </div>
  );
}
