"use client";

import { useState } from "react";
import DayLineMap from "@/components/studio/location/DayLineMap";
import WorldMap from "@/components/WorldMap";
import { useI18n } from "@/components/LocaleProvider";

/**
 * One recorded day's own stored positions — B2563 T5, D11. Built server-side
 * (`[trip]/[date]/page.tsx`, from `ownerDayLine` plus `lib/gps/positionRows.ts`)
 * into already-localised display rows, so this file only renders, selects
 * and blurs — it never touches the store or a translation key that needs a
 * raw `TransportMode`.
 *
 * **Coordinates are blurred by default** (D11: no CSV, nothing copyable at a
 * glance on a shared screen) — a CSS `blur` filter plus `select-none` on
 * every cell and the detail card's own lat/lon and "stored as" line, lifted
 * only by the "Show coordinates" toggle below. Never written to the URL,
 * `console`, or any storage — this component holds the reveal flag in plain
 * React state and nothing else.
 */
export type DisplayFixRow = {
  kind: "fix";
  index: number;
  lat: number;
  lon: number;
  timeLabel: string;
  modeLabel?: string;
  /** The mode exactly as the store wrote it (`"car"`, not "by car") — only
   *  for the detail card's own "stored as" line. */
  storedMode?: string;
  place: string;
  distanceLabel?: string;
  speedLabel?: string;
  hiddenBy?: string;
  epochSeconds: number;
};
type DisplayGapRow = { kind: "gap"; label: string };
export type DisplayRow = DisplayFixRow | DisplayGapRow;

export default function PositionsTable({
  rows,
  points,
  gapAfter,
  region,
  streetMapsOn,
  timezone,
  summary,
}: {
  rows: DisplayRow[];
  points: [number, number][];
  gapAfter: boolean[];
  region?: { bounds: [[number, number], [number, number]]; url: string };
  streetMapsOn: boolean;
  timezone: string;
  summary: string;
}) {
  const { t } = useI18n();
  const fixRows = rows.filter((r): r is DisplayFixRow => r.kind === "fix");
  const [selected, setSelected] = useState<number | null>(fixRows[0]?.index ?? null);
  const [revealed, setRevealed] = useState(false);

  const selectedRow = fixRows.find((r) => r.index === selected);

  const map =
    streetMapsOn && region ? (
      <DayLineMap
        points={points}
        gapAfter={gapAfter}
        bounds={region.bounds}
        pmtilesUrl={region.url}
        className="h-56 w-full"
        pendingSpot={selectedRow ? { lat: selectedRow.lat, lon: selectedRow.lon, radiusM: 15 } : null}
      />
    ) : (
      <WorldMap
        places={[]}
        basemap={null}
        track={[points]}
        frameHint={points.map(([lat, lng]) => ({ lat, lng }))}
        showTimeScrubber={false}
      />
    );

  return (
    <div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          aria-pressed={revealed}
          onClick={() => setRevealed((v) => !v)}
          className="min-h-11 rounded-full border border-line-strong px-4 text-sm font-semibold text-ink-strong hover:bg-surface-subtle"
        >
          {revealed ? t("studio.location.positions.reveal.hide") : t("studio.location.positions.reveal.show")}
        </button>
        <span className="text-sm text-ink-secondary">{summary}</span>
      </div>

      <div className="mt-3 grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className={`overflow-x-auto rounded-xl border border-line-quiet ${revealed ? "" : "select-none"}`}>
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-line-quiet text-left text-ink-secondary">
                <th className="px-3 py-2 font-semibold">{t("studio.location.positions.columns.time")}</th>
                <th className={`px-3 py-2 font-semibold ${revealed ? "" : "blur-sm"} hidden md:table-cell`}>
                  {t("studio.location.positions.columns.lat")}
                </th>
                <th className={`px-3 py-2 font-semibold ${revealed ? "" : "blur-sm"} hidden md:table-cell`}>
                  {t("studio.location.positions.columns.lon")}
                </th>
                <th className="px-3 py-2 font-semibold">{t("studio.location.positions.columns.mode")}</th>
                <th className="px-3 py-2 font-semibold">{t("studio.location.positions.columns.place")}</th>
                <th className="hidden px-3 py-2 font-semibold md:table-cell">
                  {t("studio.location.positions.columns.distance")}
                </th>
                <th className="hidden px-3 py-2 font-semibold md:table-cell">
                  {t("studio.location.positions.columns.speed")}
                </th>
                <th className="px-3 py-2 font-semibold">{t("studio.location.positions.columns.hiddenBy")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) =>
                row.kind === "gap" ? (
                  <tr key={`gap-${i}`} className="bg-surface-subtle">
                    <td colSpan={8} className="px-3 py-2 text-center text-ink-secondary">
                      {row.label}
                    </td>
                  </tr>
                ) : (
                  <tr
                    key={row.index}
                    tabIndex={0}
                    role="button"
                    aria-pressed={selected === row.index}
                    onClick={() => setSelected(row.index)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelected(row.index);
                      }
                    }}
                    className={`cursor-pointer border-b border-line-quiet last:border-0 hover:bg-surface-subtle ${
                      selected === row.index ? "bg-yellow-50" : ""
                    }`}
                  >
                    <td className="px-3 py-2 tabular-nums">{row.timeLabel}</td>
                    <td className={`px-3 py-2 tabular-nums ${revealed ? "" : "blur-sm"} hidden md:table-cell`}>
                      {row.lat.toFixed(5)}
                    </td>
                    <td className={`px-3 py-2 tabular-nums ${revealed ? "" : "blur-sm"} hidden md:table-cell`}>
                      {row.lon.toFixed(5)}
                    </td>
                    <td className="px-3 py-2">{row.modeLabel ?? "–"}</td>
                    <td className="px-3 py-2">{row.place}</td>
                    <td className="hidden px-3 py-2 tabular-nums md:table-cell">{row.distanceLabel ?? "–"}</td>
                    <td className="hidden px-3 py-2 tabular-nums md:table-cell">{row.speedLabel ?? "–"}</td>
                    <td className="px-3 py-2">{row.hiddenBy ?? "–"}</td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>

        <div className="space-y-3">
          <div className="overflow-hidden rounded-xl border border-line-quiet">{map}</div>
          {selectedRow && (
            <div aria-live="polite" className="rounded-2xl border border-line-quiet bg-surface-raised p-4">
              <p className="text-sm font-semibold text-ink-strong">
                {selectedRow.timeLabel} · {timezone}
                {selectedRow.hiddenBy && (
                  <>
                    {" "}
                    <span className="ml-2 rounded-full bg-surface-subtle px-2 py-0.5 text-xs font-semibold text-ink-secondary">
                      {selectedRow.hiddenBy}
                    </span>
                  </>
                )}
              </p>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                <dt className="text-ink-secondary">{t("studio.location.positions.columns.lat")}, {t("studio.location.positions.columns.lon")}</dt>
                <dd className={`text-ink-body tabular-nums ${revealed ? "" : "blur-sm select-none"}`}>
                  {selectedRow.lat.toFixed(5)}, {selectedRow.lon.toFixed(5)}
                </dd>
                <dt className="text-ink-secondary">{t("studio.location.positions.columns.mode")}</dt>
                <dd className="text-ink-body">
                  {selectedRow.modeLabel
                    ? t("studio.location.positions.detail.modeFromPhone", { mode: selectedRow.modeLabel })
                    : "–"}
                </dd>
                <dt className="text-ink-secondary">{t("studio.location.positions.columns.place")}</dt>
                <dd className="text-ink-body">{selectedRow.place}</dd>
                <dt className="text-ink-secondary">{t("studio.location.positions.detail.fromLastLabel")}</dt>
                <dd className="text-ink-body">
                  {selectedRow.index === 0
                    ? t("studio.location.positions.detail.firstOfDay")
                    : selectedRow.distanceLabel === undefined
                      ? t("studio.location.positions.detail.afterGap")
                      : t("studio.location.positions.detail.fromLast", {
                          distance: selectedRow.distanceLabel,
                          speed: selectedRow.speedLabel ?? "–",
                        })}
                </dd>
                <dt className="text-ink-secondary">{t("studio.location.positions.detail.storedAs")}</dt>
                <dd className={`font-mono text-xs text-ink-body ${revealed ? "" : "blur-sm select-none"}`}>
                  [{selectedRow.epochSeconds},{selectedRow.lat.toFixed(5)},{selectedRow.lon.toFixed(5)}
                  {selectedRow.storedMode ? `,"${selectedRow.storedMode}"` : ""}]
                </dd>
              </dl>
            </div>
          )}
          <p className="text-xs text-ink-secondary">{t("studio.location.positions.note")}</p>
        </div>
      </div>
    </div>
  );
}
