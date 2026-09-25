"use client";

import { useState } from "react";
import DoneScreen from "@/components/studio/DoneScreen";
import StepPrimary from "@/components/studio/StepPrimary";
import SubmitError from "@/components/studio/SubmitError";
import { useI18n } from "@/components/LocaleProvider";
import type { PlanReaders } from "@/lib/types";
import type { TranslationKey } from "@/lib/i18n";

/**
 * The two plan-reader cards — B2012. Shared by this page and Edit a trip's
 * own "Who sees the plan" section (B2072), so the choice reads the same in
 * both places. The card text names the budget total only when costs are
 * public, matching what a reader actually gets (`maySeeCosts`, lib/access.ts).
 */
export function PlanReadersChoice({
  levels,
  current,
  chosen,
  costsPublic,
  onChoose,
}: {
  levels: readonly PlanReaders[];
  current: PlanReaders;
  chosen: PlanReaders;
  costsPublic: boolean;
  onChoose: (level: PlanReaders) => void;
}) {
  const { t } = useI18n();
  return (
    <div role="radiogroup" aria-label={t("studio.hub.item.planReaders.title")} className="flex flex-col gap-2">
      {levels.map((level) => (
        <label
          key={level}
          className={`flex cursor-pointer items-start gap-3 rounded-2xl border bg-surface-raised px-4 py-3 ${
            chosen === level ? "border-2 border-action-strong" : "border-line-strong"
          }`}
        >
          <input
            type="radio"
            name="plan-readers"
            value={level}
            checked={chosen === level}
            onChange={() => onChoose(level)}
            className="mt-0.5 h-5 w-5 flex-none accent-action-strong"
          />
          <span>
            <span className="block text-base font-semibold text-ink-strong">
              {t(`studio.planReaders.${level}.title` as TranslationKey)}
              {level === current && (
                <>
                  {" "}
                  <span className="ml-1 text-xs font-normal text-ink-secondary">{t("studio.tripVisibility.nowLabel")}</span>
                </>
              )}
            </span>
            <span className="block text-sm text-ink-secondary">
              {t(`studio.planReaders.${level}.description${costsPublic ? "" : "NoCosts"}` as TranslationKey)}
            </span>
          </span>
        </label>
      ))}
    </div>
  );
}

/**
 * "What does a reader see of the plan" — B2012; one page since B2071. No
 * confirm step: a non-destructive save with nothing to undo by switching back.
 * The frame, title and trip picker are the page's.
 */
export default function TripPlanReadersFlow({
  username,
  trip,
  readerLevels,
  costsPublic,
}: {
  username: string;
  trip: { id: string; title: string; readers: PlanReaders };
  /** `PLAN_READERS` from `lib/tripWrite.ts`, read server-side. */
  readerLevels: readonly PlanReaders[];
  costsPublic: boolean;
}) {
  const { t } = useI18n();
  const [chosen, setChosen] = useState<PlanReaders>(trip.readers);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function commit() {
    setBusy(true);
    setError(null);
    const res = await fetch(
      `/api/web/${encodeURIComponent(username)}/trips/${encodeURIComponent(trip.id)}/plan-readers`,
      { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ readers: chosen }) },
    ).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setError(t("studio.planReaders.writeFailed"));
      return;
    }
    setDone(true);
    window.scrollTo(0, 0);
  }

  if (done) {
    return (
      <DoneScreen
        username={username}
        done={t("studio.planReaders.done", {
          title: trip.title,
          // Mid-sentence after the colon: "now see: the details too".
          level: t(`studio.planReaders.${chosen}.title` as TranslationKey).replace(/^./, (c) => c.toLowerCase()),
        })}
        next={[{ title: trip.title, href: `/${username}/trips/${trip.id}`, label: t("studio.planReaders.openPlan") }]}
      />
    );
  }

  return (
    <div className="mt-4">
      <PlanReadersChoice
        levels={readerLevels}
        current={trip.readers}
        chosen={chosen}
        costsPublic={costsPublic}
        onChoose={(level) => {
          setChosen(level);
          setError(null);
        }}
      />
      <div className="mt-4">
        <StepPrimary
          tone="bg-yellow-400 text-yellow-950"
          disabled={chosen === trip.readers}
          busy={busy}
          busyLabel={t("studio.planReaders.saving")}
          onClick={() => void commit()}
          label={t("studio.planReaders.save")}
        />
        <SubmitError message={error} />
      </div>
    </div>
  );
}
