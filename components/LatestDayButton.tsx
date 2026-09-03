"use client";

import { Flag, LocateFixed } from "lucide-react";
import { useI18n } from "./LocaleProvider";

/**
 * Jump to the day the story opens at.
 *
 * That day is "today" only while the trip is still running. `getDefaultDay`
 * (lib/entries.ts) lands a finished trip on its **last** day, so on an
 * archived trip the jump did the right thing and the label lied: a reader
 * paging through a 2024 trip was offered "Today" and arrived in September
 * 2024 (B12).
 *
 * The control is not hidden once a trip is over — somebody on day 3 of 18
 * still wants a way back to where it ended — it is renamed, against the same
 * target.
 *
 * One component because the wording had already drifted: the desktop day bar,
 * the mobile sheet and the hero each rendered their own copy of this button,
 * and a fix applied to one of them leaves the other two lying.
 */
export default function LatestDayButton({
  tripOver,
  onClick,
  className,
  iconClassName = "h-4 w-4",
}: {
  /** Whether the trip has finished — see `isOver` in lib/tripTime.ts. */
  tripOver: boolean;
  onClick: () => void;
  /** The host decides how it looks; each of the three sites is shaped
   * differently by its container. */
  className: string;
  iconClassName?: string;
}) {
  const { t } = useI18n();
  const Icon = tripOver ? Flag : LocateFixed;
  return (
    <button
      onClick={onClick}
      // The one thing a test can assert without reading a translation.
      data-jump={tripOver ? "last-day" : "today"}
      className={className}
    >
      <Icon className={iconClassName} aria-hidden />
      {t(tripOver ? "day.lastDay" : "day.today")}
    </button>
  );
}
