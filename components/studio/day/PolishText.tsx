"use client";

import { useState } from "react";
import Link from "next/link";
import BusyButton from "@/components/BusyButton";
import { useI18n } from "@/components/LocaleProvider";
import { formatCredits } from "@/lib/creditsFormat";
import { WRITE_DAY_CREDITS, WRITE_DAY_NOTES_MAX_CHARS } from "@/lib/helper/credits";
import type { TranslationKey } from "@/lib/i18n";

/** A text link only appears once there is enough written to be worth
 *  polishing — the same reasoning as showing a price before the tap: a
 *  one-word field has nothing for the model to rework. */
const MIN_WORDS = 12;

function wordCount(text: string): number {
  return text.trim() === "" ? 0 : text.trim().split(/\s+/).length;
}

/** One sentence per code `write-day/route.ts` can answer with — B2184's
 *  pattern, reused here for `mode: "polish"`. Anything the route does not
 *  name falls back to the generic line. `creditsLink` mirrors B2184's old
 *  assist UI (`AddDayFlow.tsx`, `assistErrorFor`), removed in B2188 — B2224
 *  restores the "Add credits" way out for `no_credits` here. */
function polishErrorFor(
  t: (key: TranslationKey, vars?: Record<string, string>) => string,
  code: string | undefined,
): { message: string; creditsLink?: boolean } {
  switch (code) {
    case "polish_added_facts":
      return { message: t("studio.day.polish.error.addedFacts") };
    case "no_credits":
      return { message: t("studio.day.polish.error.noCredits"), creditsLink: true };
    case "model_failed":
      return { message: t("studio.day.polish.error.modelFailed") };
    case "too_many_requests":
      return { message: t("studio.day.polish.error.tooManyRequests") };
    case "helper_unavailable":
      return { message: t("studio.day.polish.error.unavailable") };
    case "consent_required":
      return { message: t("studio.day.polish.error.consentRequired") };
    case "notes_too_long":
      return { message: t("studio.day.polish.error.notesTooLong", { max: String(WRITE_DAY_NOTES_MAX_CHARS) }) };
    case "no_notes":
      return { message: t("studio.day.polish.error.noNotes") };
    default:
      return { message: t("studio.day.polish.error") };
  }
}

/**
 * "Polish my text" — B2190.
 *
 * The owner's own words go in and the same words, reworded, come back beside
 * them; nothing is used until they tap "Use this". `onUse` is the only way
 * this component ever changes the field it sits under — never on its own, on
 * a fetch resolving, or on an error.
 */
export default function PolishText({
  username,
  trip,
  text,
  onUse,
  credits,
  priceChf,
}: {
  username: string;
  trip: string;
  text: string;
  onUse: (polished: string) => void;
  credits: number | null;
  /** "about CHF x.xx" for the tap, computed server-side (B2254 — pricing is
   *  paid-only code after the open-core split, so this component never
   *  imports it). `null` when pricing is unavailable (a public build): the
   *  link then shows the credit price alone rather than a wrong CHF 0.00. */
  priceChf: string | null;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; creditsLink?: boolean } | null>(null);
  const [polished, setPolished] = useState<string | null>(null);

  if (credits === null || wordCount(text) < MIN_WORDS) return null;

  // B2234 — say so before the tap rather than after a refused fetch: the
  // owner already knows their balance (it is the page's own `polishCredits`,
  // read server-side), so there is nothing to ask the route to find out.
  if (credits < WRITE_DAY_CREDITS) {
    return (
      <div className="mt-2">
        <p className="text-sm text-ink-secondary">
          {t("studio.day.polish.noCreditsBeforeTap")}{" "}
          <Link href={`/${username}/studio/account`} className="font-semibold underline underline-offset-2">
            {t("studio.day.polish.error.noCredits.link")}
          </Link>
        </p>
      </div>
    );
  }

  async function requestPolish() {
    setBusy(true);
    setError(null);
    setPolished(null);
    try {
      const res = await fetch(`/api/helper/${encodeURIComponent(username)}/day/write-day`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ trip, notes: text, mode: "polish" }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok?: boolean; draft?: { prose: string } }
        | { error?: string }
        | null;
      if (!res.ok || !json || !("ok" in json) || !json.ok || !json.draft) {
        setError(polishErrorFor(t, json && "error" in json ? json.error : undefined));
        setOpen(true);
        return;
      }
      setPolished(json.draft.prose);
      setOpen(true);
    } catch {
      setError(polishErrorFor(t, undefined));
      setOpen(true);
    } finally {
      setBusy(false);
    }
  }

  function useIt() {
    if (polished === null) return;
    onUse(polished);
    setOpen(false);
    setPolished(null);
  }

  function keepMine() {
    setOpen(false);
    setPolished(null);
    setError(null);
  }

  return (
    <div className="mt-2">
      <BusyButton
        busy={busy}
        type="button"
        onClick={requestPolish}
        className="min-h-11 text-sm font-semibold text-ink-strong underline underline-offset-2"
      >
        {priceChf === null
          ? t("studio.day.polish.linkNoPrice", { price: formatCredits(WRITE_DAY_CREDITS) })
          : t("studio.day.polish.link", { price: formatCredits(WRITE_DAY_CREDITS), money: priceChf })}
      </BusyButton>

      {open && (
        <div className="mt-2 rounded-xl border border-line-strong px-4 py-3">
          {error && (
            <p role="alert" className="text-sm text-coral-600">
              {error.message}
              {error.creditsLink && (
                <>
                  {" "}
                  <Link href={`/${username}/studio/account`} className="font-semibold underline underline-offset-2">
                    {t("studio.day.polish.error.noCredits.link")}
                  </Link>
                </>
              )}
            </p>
          )}
          {polished !== null && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-xs font-semibold text-ink-secondary">{t("studio.day.polish.yours")}</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-ink-body">{text}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-ink-secondary">{t("studio.day.polish.polished")}</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-ink-body">{polished}</p>
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={useIt}
                  className="min-h-11 rounded-full border border-line-strong px-4 text-sm font-semibold text-ink-strong hover:bg-surface-subtle"
                >
                  {t("studio.day.polish.useThis")}
                </button>
                <button
                  type="button"
                  onClick={keepMine}
                  className="min-h-11 rounded-full px-4 text-sm font-semibold text-ink-secondary"
                >
                  {t("studio.day.polish.keepMine")}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
