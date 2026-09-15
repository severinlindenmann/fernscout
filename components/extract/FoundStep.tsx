"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/components/LocaleProvider";
import StepIndicator from "@/components/extract/StepIndicator";
import type { DayGroup } from "@/lib/extract/group";
import type { RunManifest } from "@/lib/staging/manifest";

type RunResponse = { manifest: RunManifest; groups: DayGroup[] };

/** The wizard's own fixed shape (S2a–S4 of the design) — this is Step 04 of 5. */
const TOTAL_STEPS = 5;

/**
 * Step 04 of the design — "what the photographs already knew".
 *
 * B1797. The coordinator's own read of the draft calls this the most
 * valuable screen in it, and the plan's own "spec coverage" table never
 * assigned it to a task — Task 1.3 went straight from the upload to the day
 * board. Every number here is read back from the same `GET .../extract/run`
 * `DayBoard` already calls; this is a second, earlier look at the same
 * response, computed rather than fetched twice for anything but the numbers.
 *
 * **Nothing here is guessed.** "Dates 118 of 120" is a count of
 * `PhotoRow.date`, set only where `readExif` actually found one
 * (`lib/extract/analyse.ts`); "Weather" and "Who's in them" are not counts
 * at all — they are true sentences about what this flow does next (an
 * archive lookup once a day has a place and a date; a question, always,
 * because nobody's camera roll knows who is in a photograph).
 */
export default function FoundStep({
  username,
  runId,
  onContinue,
}: {
  username: string;
  runId: string;
  onContinue: () => void;
}) {
  const { t, tn } = useI18n();
  const [data, setData] = useState<RunResponse | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setError(false);
      try {
        const res = await fetch(
          `/api/helper/${encodeURIComponent(username)}/extract/run?run=${encodeURIComponent(runId)}`,
        );
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as RunResponse;
        if (!cancelled) setData(json);
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [username, runId]);

  if (error) {
    return <p className="mt-4 text-sm text-red-700">{t("extract.found.error")}</p>;
  }
  if (!data) {
    return <p className="mt-4 text-sm text-ink-secondary">{t("extract.found.loading")}</p>;
  }

  const photos = data.manifest.photos.filter((p) => !p.dropped);
  const total = photos.length;
  const days = data.groups.filter((g) => !g.undated).length;
  const withDate = photos.filter((p) => p.date).length;
  const withPlace = photos.filter((p) => p.lat !== undefined && p.lng !== undefined).length;
  const withTime = photos.filter((p) => p.takenAt).length;
  const withoutPlace = total - withPlace;

  return (
    <div className="mt-4">
      <StepIndicator
        total={TOTAL_STEPS}
        current={4}
        label={t("extract.step.ofTotal", { current: "4", total: String(TOTAL_STEPS) })}
      />
      <h2 className="font-display text-xl font-semibold leading-tight text-ink-strong">
        {tn("extract.board.photoCount", total, { count: String(total) })},{" "}
        {tn("extract.found.dayCount", days, { count: String(days) })}
      </h2>
      <p className="mt-1 text-sm text-ink-secondary">{t("extract.found.subtitle")}</p>

      <ul className="mt-4 divide-y divide-line-faint rounded-xl border border-line-strong">
        <Row label={t("extract.found.dates")} value={`${withDate} / ${total}`} />
        <Row label={t("extract.found.places")} value={`${withPlace} / ${total}`} />
        <Row label={t("extract.found.timeOfDay")} value={`${withTime} / ${total}`} />
        <Row label={t("extract.found.weather")} value={t("extract.found.weatherValue")} />
        <Row label={t("extract.found.who")} value={t("extract.found.whoValue")} />
      </ul>

      {withoutPlace > 0 && (
        <div className="mt-4 rounded-xl bg-surface-subtle p-4">
          <p className="text-sm font-semibold text-ink-strong">
            {tn("extract.found.withoutPlaceTitle", withoutPlace, { count: String(withoutPlace) })}
          </p>
          <p className="mt-1 text-sm text-ink-body">{t("extract.found.withoutPlaceBody")}</p>
        </div>
      )}

      <button
        type="button"
        onClick={onContinue}
        className="mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-full bg-yellow-400 px-5 text-base font-semibold text-yellow-950 transition-colors hover:bg-yellow-300"
      >
        {tn("extract.found.seeDays", days, { count: String(days) })}
      </button>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <li className="flex items-center justify-between gap-3 px-4 py-3">
      <span className="text-sm text-ink-strong">{label}</span>
      <span className="text-sm text-ink-secondary">{value}</span>
    </li>
  );
}
