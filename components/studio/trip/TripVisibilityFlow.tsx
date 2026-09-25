"use client";

import { useState } from "react";
import ConfirmPanel from "@/components/ConfirmPanel";
import DoneScreen from "@/components/studio/DoneScreen";
import StepPrimary from "@/components/studio/StepPrimary";
import SubmitError from "@/components/studio/SubmitError";
import { useI18n } from "@/components/LocaleProvider";
import type { TripPreview } from "@/lib/studio/audiencePreview";
import type { TranslationKey } from "@/lib/i18n";

type Visibility = "private" | "public" | "guest";

/** How widely each visibility reads — `patchTripVisibility`'s own `REACH`
 *  (`lib/api/tripVisibility.ts`), duplicated here only as a ranking so this
 *  client component can tell widening from narrowing without importing a
 *  server-only module. */
const REACH: Record<Visibility, number> = { private: 0, guest: 1, public: 2 };

/**
 * "Who may read this trip" — B1833, spec §7.6; one page since B2071.
 *
 * One question, so no wizard: three radio cards, what the chosen audience
 * would see (V2, computed server-side by `lib/studio/audiencePreview.ts`'s
 * real gate) right under them, and one commit in the bar. The three canned
 * labels do all the talking (V1). **Confirmation only when widening** (V3) —
 * narrowing asks nothing: "asking in both directions trains people to press
 * through the question." The frame, title and lede are `StudioPage`'s.
 */
export default function TripVisibilityFlow({
  username,
  trip,
  visibilities,
  previews,
}: {
  username: string;
  trip: { id: string; title: string; visibility: string; listed: boolean; teaser: boolean };
  /** `VISIBILITIES` from `lib/tripWrite.ts`, read server-side. */
  visibilities: readonly string[];
  /** One precomputed preview per candidate visibility. */
  previews: Record<string, TripPreview>;
}) {
  const { t, tn } = useI18n();
  const [chosen, setChosen] = useState<Visibility>(trip.visibility as Visibility);
  // The one follow-up question each side of the public line asks: a public
  // trip whether it is advertised, a closed one whether it shows a locked
  // card. Sent with the visibility, so the answer is the owner's, not a
  // default (the moved `TripVisibilityFor`'s two checkboxes, B1591).
  const [listed, setListed] = useState(trip.listed);
  const [teaser, setTeaser] = useState(trip.teaser);
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = trip.visibility as Visibility;
  const preview = previews[chosen];
  const label = (v: string) => t(`studio.visibility.${v}.title` as TranslationKey);
  const unchanged =
    chosen === current && (chosen === "public" ? listed === trip.listed : teaser === trip.teaser);

  async function commit() {
    setBusy(true);
    setError(null);
    const res = await fetch(
      `/api/web/${encodeURIComponent(username)}/trips/${encodeURIComponent(trip.id)}/visibility`,
      { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(chosen === "public" ? { visibility: chosen, listed } : { visibility: chosen, teaser }) },
    ).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setError(t("studio.tripVisibility.writeFailed.message"));
      return;
    }
    setConfirming(false);
    setDone(true);
    window.scrollTo(0, 0);
  }

  if (done) {
    return (
      <DoneScreen
        username={username}
        done={t("studio.tripVisibility.done.banner", { title: trip.title, visibility: label(chosen) })}
        next={[{ title: trip.title, href: `/${username}/trips/${trip.id}`, label: t("studio.tripVisibility.done.openTrip") }]}
      />
    );
  }

  return (
    <div className="mt-4">
      <div role="radiogroup" aria-label={t("studio.tripVisibility.heading", { title: trip.title })} className="flex flex-col gap-2">
        {visibilities.map((v) => (
          <label
            key={v}
            className={`flex cursor-pointer items-start gap-3 rounded-2xl border bg-surface-raised px-4 py-3 ${
              chosen === v ? "border-2 border-action-strong" : "border-line-strong"
            }`}
          >
            <input
              type="radio"
              name="visibility"
              value={v}
              checked={chosen === v}
              disabled={confirming}
              onChange={() => {
                setChosen(v as Visibility);
                setError(null);
              }}
              className="mt-0.5 h-5 w-5 flex-none accent-action-strong"
            />
            <span>
              <span className="block text-base font-semibold text-ink-strong">
                {label(v)}
                {v === current && (
                  <>
                    {" "}
                    <span className="ml-1 text-xs font-normal text-ink-secondary">{t("studio.tripVisibility.nowLabel")}</span>
                  </>
                )}
              </span>
              <span className="block text-sm text-ink-secondary">
                {t(`studio.visibility.${v}.description` as TranslationKey)}
              </span>
            </span>
          </label>
        ))}
      </div>

      <label className="mt-3 flex items-start gap-2.5 text-sm text-ink-body">
        <input
          type="checkbox"
          checked={chosen === "public" ? listed : teaser}
          disabled={confirming}
          onChange={(e) => (chosen === "public" ? setListed(e.target.checked) : setTeaser(e.target.checked))}
          className="mt-0.5 h-4 w-4 flex-none rounded border-line-strong"
        />
        {chosen === "public" ? (
          t("edit.tripListed")
        ) : (
          <span>
            {t("visibility.teaser")}
            <span className="block text-xs text-ink-secondary">{t("visibility.teaserHint")}</span>
          </span>
        )}
      </label>

      {preview && (
        <section className="mt-4 rounded-2xl border border-line-strong bg-surface-subtle px-4 py-3 text-sm">
          <p className="font-mono text-xs uppercase tracking-wide text-ink-secondary">{t("studio.tripVisibility.preview.theySee")}</p>
          <p className="mt-1 font-semibold text-ink-strong">
            {preview.opens
              ? t("studio.tripVisibility.preview.theySeeValue", {
                  days: tn("studio.tripVisibility.preview.publishedDays", preview.publishedDays, { count: String(preview.publishedDays) }),
                  photos: tn("studio.day.preview.photoCount", preview.photoCount, { count: String(preview.photoCount) }),
                })
              : t("studio.tripVisibility.preview.nothing")}
            {/* B2130 — the money follows the trip's own costs.visibility. */}
            {preview.costsVisible && ` · ${t("studio.tripVisibility.preview.money")}`}
          </p>
          <p className="mt-3 font-mono text-xs uppercase tracking-wide text-ink-secondary">{t("studio.tripVisibility.preview.theyDoNot")}</p>
          {/* B2132 — drafts and held-back days are separate facts. */}
          <ul className="mt-1 text-ink-body" data-they-do-not>
            <li>{tn("studio.tripVisibility.preview.draftDays", preview.draftDays, { count: String(preview.draftDays) })}</li>
            {preview.heldBackDays > 0 && (
              <li>{tn("studio.tripVisibility.preview.heldBackDays", preview.heldBackDays, { count: String(preview.heldBackDays) })}</li>
            )}
            {!preview.costsVisible && <li>{t("studio.tripVisibility.preview.money")}</li>}
          </ul>
        </section>
      )}

      {confirming ? (
        <div className="mt-4">
          <ConfirmPanel
            label={t("studio.tripVisibility.confirm.label")}
            question={tn("studio.tripVisibility.confirm.question", preview?.publishedDays ?? 0, {
              title: trip.title,
              from: label(current),
              to: label(chosen),
              days: String(preview?.publishedDays ?? 0),
            })}
            details={t("studio.tripVisibility.confirm.details")}
            confirmLabel={t("studio.tripVisibility.confirm.confirmLabel", { visibility: label(chosen) })}
            busyLabel={t("studio.tripVisibility.confirm.busyLabel")}
            busy={busy}
            error={error ?? undefined}
            onConfirm={commit}
            onCancel={() => {
              setConfirming(false);
              setError(null);
            }}
          />
        </div>
      ) : (
        <div className="mt-4">
          <StepPrimary
            tone="bg-yellow-400 text-yellow-950"
            disabled={unchanged}
            busy={busy}
            busyLabel={t("studio.tripVisibility.confirm.busyLabel")}
            onClick={() => (REACH[chosen] > REACH[current] ? setConfirming(true) : void commit())}
            label={
              chosen === current
                ? t("me.journalSave")
                : t("studio.tripVisibility.confirm.confirmLabel", { visibility: label(chosen) })
            }
          />
          <SubmitError message={error} />
        </div>
      )}
    </div>
  );
}
