"use client";

import { useI18n } from "@/components/LocaleProvider";
import type { PlanDoc } from "@/lib/planner/types";

/**
 * The Links screen — trip-level and per-stop lists, both under
 * `plan.private` (owner/trip-people only). "Add a link" is a hint back to
 * the composer set to Link, not a second add path — the ticket's own line.
 */
export default function LinksPanel({
  plan,
  onSave,
  onBack,
  onAddLink,
  saveStatus,
}: {
  plan: PlanDoc;
  onSave: (next: PlanDoc) => void;
  onBack: () => void;
  onAddLink: () => void;
  saveStatus: "idle" | "saving" | "saved" | "failed";
}) {
  const { t } = useI18n();
  const tripLinks = plan.private?.links ?? [];
  const stopLinks = plan.route.flatMap((s) =>
    (plan.private?.stops?.[s.id ?? ""]?.links ?? []).map((link, i) => ({ ...link, stopId: s.id, stopLabel: s.location, i })),
  );

  function removeTripLink(index: number) {
    onSave({ ...plan, private: { ...(plan.private ?? {}), links: tripLinks.filter((_, i) => i !== index) } });
  }

  function removeStopLink(stopId: string, index: number) {
    const stops = { ...(plan.private?.stops ?? {}) };
    const existing = stops[stopId] ?? {};
    stops[stopId] = { ...existing, links: (existing.links ?? []).filter((_, i) => i !== index) };
    onSave({ ...plan, private: { ...(plan.private ?? {}), stops } });
  }

  return (
    <div>
      <button type="button" onClick={onBack} className="min-h-11 text-sm underline">
        {t("studio.plan.back")}
      </button>
      <h2 className="mt-2 font-display text-xl font-semibold text-ink-strong">{t("studio.plan.links.title")}</h2>
      <p className="text-sm text-ink-secondary">{t("studio.plan.links.private")}</p>

      <div className="mt-3 rounded-xl border border-line-strong p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">{t("studio.plan.links.forTrip")}</p>
        {tripLinks.length === 0 && <p className="text-sm text-ink-secondary">{t("studio.plan.stop.none")}</p>}
        {tripLinks.map((link, i) => (
          <div key={`${link.url}-${i}`} className="flex items-center justify-between border-b border-line-faint py-2 text-sm">
            <span>
              <b>{link.label}</b> <span className="text-ink-secondary">{link.url}</span>
            </span>
            <button type="button" onClick={() => removeTripLink(i)} className="min-h-11 text-coral-600 underline">
              {t("studio.plan.money.delete")}
            </button>
          </div>
        ))}
      </div>

      <div className="mt-3 rounded-xl border border-line-strong p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">{t("studio.plan.links.onPlace")}</p>
        {stopLinks.length === 0 && <p className="text-sm text-ink-secondary">{t("studio.plan.stop.none")}</p>}
        {stopLinks.map((link) => (
          <div key={`${link.stopId}-${link.url}-${link.i}`} className="flex items-center justify-between border-b border-line-faint py-2 text-sm">
            <span>
              <b>{link.label}</b> <span className="text-ink-secondary">{link.stopLabel} · {link.url}</span>
            </span>
            <button
              type="button"
              onClick={() => removeStopLink(link.stopId ?? "", link.i)}
              className="min-h-11 text-coral-600 underline"
            >
              {t("studio.plan.money.delete")}
            </button>
          </div>
        ))}
      </div>

      <button type="button" onClick={onAddLink} className="mt-3 min-h-11 rounded-full bg-action-strong px-5 text-sm font-semibold text-on-action">
        {t("studio.plan.links.add")}
      </button>
      <p className="mt-1 text-xs text-ink-secondary">{t("studio.plan.links.addHint")}</p>

      {saveStatus === "failed" ? (
        <p role="alert" className="mt-3 text-sm text-coral-600">{t("studio.plan.failed")}</p>
      ) : (
        <p role="status" className="mt-3 text-sm text-action-strong">
          {saveStatus === "saving" && t("studio.plan.saving")}
          {saveStatus === "saved" && t("studio.plan.saved")}
        </p>
      )}
    </div>
  );
}
