import type { TripPreview } from "@/lib/studio/audiencePreview";
import type { Count, Translate } from "./shared";

/**
 * What a reader of this journal would see — the same for every person, so it
 * sits once under the two doors (B2130/B2132, kept by B2291 from the invite
 * section it used to live in). Drafts, held-back days, money and closed trips
 * are separate facts, each said only when true.
 */
export default function ReaderPreview({ preview, t, tn }: { preview: TripPreview[]; t: Translate; tn: Count }) {
  const openTrips = preview.filter((p) => p.opens);
  const closedTrips = preview.filter((p) => !p.opens);
  const totalPublishedDays = openTrips.reduce((sum, p) => sum + p.publishedDays, 0);
  const totalDraftDays = preview.reduce((sum, p) => sum + p.draftDays, 0);
  const totalHeldBackDays = preview.reduce((sum, p) => sum + p.heldBackDays, 0);
  const seesCosts = openTrips.some((p) => p.costsVisible);

  return (
    <details className="mt-4 rounded-2xl border border-line-quiet bg-surface-raised p-4">
      <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-ink-strong">
        {t("studio.readers.invite.preview")}
      </summary>
      <p className="mt-1 text-sm text-ink-body">
        {t("studio.invite.what.consequence")}{" "}
        {t(seesCosts ? "studio.invite.what.promiseCosts" : "studio.invite.what.promise")}
      </p>
      {totalPublishedDays === 0 && (
        <p className="mt-3 rounded-xl border border-coral-300 bg-coral-50 px-4 py-3 text-sm text-ink-body">
          {t("studio.invite.preview.nothingPublished")}
        </p>
      )}
      <ul className="mt-3 divide-y divide-line-faint rounded-xl border border-line-strong">
        {openTrips.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
            <span className="text-ink-strong">{p.title}</span>
            <span className="text-xs text-ink-secondary">
              {t("studio.invite.preview.tripSummary", {
                days: tn("studio.invite.preview.days", p.publishedDays, { count: String(p.publishedDays) }),
                photos: tn("studio.day.preview.photoCount", p.photoCount, { count: String(p.photoCount) }),
              })}
              {p.costsVisible && ` · ${t("studio.tripVisibility.preview.money")}`}
            </span>
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">
              {t("studio.invite.preview.yes")}
            </span>
          </li>
        ))}
        {closedTrips.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-2 px-4 py-2 text-sm italic text-ink-secondary">
            <span>{p.title}</span>
            <span className="rounded-full bg-surface-subtle px-2 py-0.5 text-xs font-semibold text-ink-secondary">
              {t("studio.invite.preview.no")}
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-3 text-sm text-ink-body">
        <p className="font-semibold text-ink-strong">{t("studio.tripVisibility.preview.theyDoNot")}</p>
        <ul className="mt-1" data-they-do-not>
          <li>{tn("studio.tripVisibility.preview.draftDays", totalDraftDays, { count: String(totalDraftDays) })}</li>
          {totalHeldBackDays > 0 && (
            <li>{tn("studio.tripVisibility.preview.heldBackDays", totalHeldBackDays, { count: String(totalHeldBackDays) })}</li>
          )}
          {!seesCosts && <li>{t("studio.invite.preview.money")}</li>}
          {closedTrips.length > 0 && (
            <li>{tn("studio.invite.preview.privateTrips", closedTrips.length, { count: String(closedTrips.length) })}</li>
          )}
        </ul>
      </div>
    </details>
  );
}
