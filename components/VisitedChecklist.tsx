"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import BusyButton from "@/components/BusyButton";
import { useI18n } from "@/components/LocaleProvider";
import { useSite } from "@/components/SiteProvider";
import VisitedSheet from "@/components/VisitedSheet";
import { countryName, matchesName } from "@/lib/countries";
import { flagFromCode } from "@/lib/flags";
import { CONTINENT_KEY } from "@/lib/mapRegions";

const CONTINENT_ORDER = ["Europe", "Asia", "Africa", "North America", "South America", "Oceania"];

/**
 * Tick off many countries at once (B2914): the countries grouped by continent
 * with a search box. A country a trip already reached, or one already entered,
 * is shown ticked and locked. Everything ticked is added in one batch with the
 * default audience (Guests) and nothing else; a photo, a year or a few words
 * can be added to each later from its own entry.
 */
export default function VisitedChecklist({
  choices,
  tripCodes,
  entryCodes,
  onBack,
  onClose,
}: {
  choices: { code: string; continent: string }[];
  /** Countries a readable trip reached — ticked, locked, "from a trip". */
  tripCodes: Set<string>;
  /** Countries that already have an entry — ticked, locked. */
  entryCodes: Set<string>;
  onBack: () => void;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const { username } = useSite();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return CONTINENT_ORDER.map((continent) => ({
      continent,
      rows: choices
        .filter((c) => c.continent === continent)
        .map((c) => ({ code: c.code, name: countryName(c.code, locale) }))
        .filter((c) => q === "" || matchesName(c.code, q, locale) || c.code.toLowerCase() === q)
        .sort((a, b) => a.name.localeCompare(b.name, locale)),
    })).filter((g) => g.rows.length > 0);
  }, [choices, query, locale]);

  function toggle(code: string) {
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  async function add() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/web/${encodeURIComponent(username)}/visited`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entries: [...ticked].map((country) => ({ country })) }),
      });
      if (!res.ok) throw new Error(String(res.status));
      router.refresh();
      onClose();
    } catch {
      setError(t("visited.errorGeneric"));
      setBusy(false);
    }
  }

  return (
    <VisitedSheet
      title={t("visited.checklistTitle")}
      onClose={onClose}
      footer={
        <>
          {error && (
            <p role="alert" className="mb-2 text-sm text-coral-600">
              {error}
            </p>
          )}
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-ink-secondary" aria-live="polite">
              {t("visited.checklistFooter", { n: String(ticked.size) })}
            </p>
            <BusyButton
              busy={busy}
              type="button"
              disabled={ticked.size === 0}
              onClick={() => void add()}
              className="min-h-11 shrink-0 rounded-full bg-ink-strong px-5 text-base font-semibold text-surface-raised disabled:opacity-50"
            >
              {busy ? t("visited.saving") : t("visited.checklistAdd", { n: String(ticked.size) })}
            </BusyButton>
          </div>
        </>
      }
    >
      <div className="px-5 pb-1 pt-4">
        <button
          type="button"
          onClick={onBack}
          className="min-h-11 text-sm text-ink-secondary underline underline-offset-4 hover:text-ink-strong"
        >
          {t("visited.back")}
        </button>
        <p className="text-sm text-ink-secondary">{t("visited.checklistIntro")}</p>
        <input
          type="search"
          aria-label={t("visited.countrySearch")}
          placeholder={t("visited.countrySearch")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="mt-3 min-h-11 w-full rounded-xl border border-line-quiet bg-surface-raised px-3 py-2 text-base text-ink-strong"
        />
      </div>
      {groups.length === 0 && <p className="px-5 py-4 text-sm text-ink-secondary">{t("visited.countryNone")}</p>}
      {groups.map((g) => (
        <section key={g.continent} aria-label={t(CONTINENT_KEY[g.continent])}>
          <h3 className="sticky top-0 bg-surface-subtle px-5 py-1.5 text-xs font-semibold text-ink-secondary">
            {t(CONTINENT_KEY[g.continent])}
          </h3>
          <ul>
            {g.rows.map((c) => {
              const fromTrip = tripCodes.has(c.code);
              const locked = fromTrip || entryCodes.has(c.code);
              return (
                <li key={c.code} className="border-b border-line-quiet">
                  <label className="flex min-h-12 cursor-pointer items-center gap-3 px-5 text-base text-ink-strong has-[:disabled]:cursor-default">
                    <input
                      type="checkbox"
                      className="h-5 w-5 shrink-0 accent-ink-strong"
                      checked={locked || ticked.has(c.code)}
                      disabled={locked}
                      onChange={() => toggle(c.code)}
                    />
                    <span aria-hidden>{flagFromCode(c.code)}</span>
                    <span className="flex-1">{c.name}</span>
                    {locked && (
                      <span className="text-xs text-ink-secondary">
                        {fromTrip ? t("visited.fromTrip") : t("visited.alreadyAdded")}
                      </span>
                    )}
                  </label>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </VisitedSheet>
  );
}
