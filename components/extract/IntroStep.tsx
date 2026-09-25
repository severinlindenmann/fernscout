"use client";

import { useI18n } from "@/components/LocaleProvider";
import StepPrimary from "@/components/studio/StepPrimary";

/**
 * Step 01 of the design — "say what this is before asking for anything".
 *
 * B1797. Nobody hands over their camera roll to a screen that hasn't
 * explained itself; this is the expectation-setter the plan's own Task 1.3
 * never got a brief for. Three things, in the structure the visual draft
 * (`.superpowers/sdd/b1797/design-v2.html`, Step 01) actually specifies
 * rather than a paragraph: a four-row "what happens, in order, how long",
 * a panel naming exactly where the photographs go while this is in
 * progress, and a reassurance line under the button — the draft's own
 * research note that a single "you can change this anytime" line measurably
 * cuts abandonment.
 *
 * Facts, not links: "deleted within two days" and "doesn't count against
 * your storage" are stated here rather than behind a tap, because a fact
 * behind a link is a fact people decide to read later, which is never.
 *
 * B2137: the start button is the studio bar's one primary (`StepPrimary`),
 * navy because starting writes nothing; the reassurance line stays last.
 */
export default function IntroStep({ onContinue }: { onContinue: () => void }) {
  const { t } = useI18n();

  const rows: { label: string; timing: string }[] = [
    { label: t("studio.photos.intro.row.choose"), timing: t("studio.photos.intro.row.choose.time") },
    { label: t("studio.photos.intro.row.read"), timing: t("studio.photos.intro.row.read.time") },
    { label: t("studio.photos.intro.row.tell"), timing: t("studio.photos.intro.row.tell.time") },
    { label: t("studio.photos.intro.row.keep"), timing: t("studio.photos.intro.row.keep.time") },
  ];

  return (
    <div className="mt-4">
      <h2 className="font-display text-xl font-semibold leading-tight text-ink-strong">
        {t("studio.photos.intro.title")}
      </h2>
      <p className="mt-1 text-sm text-ink-secondary">{t("studio.photos.intro.subtitle")}</p>

      <ul className="mt-4 divide-y divide-line-faint rounded-xl border border-line-strong">
        {rows.map((row, i) => (
          <li key={row.label} className="flex items-center justify-between gap-3 px-4 py-3">
            <span className="text-sm font-semibold text-ink-strong">
              {i + 1} · {row.label}
            </span>
            <span className="whitespace-nowrap text-xs text-ink-secondary">{row.timing}</span>
          </li>
        ))}
      </ul>

      <div className="mt-4 rounded-xl bg-surface-subtle p-4">
        <p className="text-sm font-semibold text-ink-strong">{t("studio.photos.intro.whereTitle")}</p>
        <ul className="mt-2 flex flex-col gap-2">
          <li className="text-sm text-ink-body">{t("studio.photos.intro.whereHolding")}</li>
          <li className="text-sm text-ink-body">{t("studio.photos.intro.whereExpires")}</li>
          <li className="text-sm text-ink-body">{t("studio.photos.intro.whereNothingVisible")}</li>
        </ul>
      </div>

      <StepPrimary label={t("studio.photos.intro.start")} onClick={onContinue} />
      <p className="mt-4 text-xs text-ink-secondary">{t("studio.photos.intro.reassure")}</p>
    </div>
  );
}
