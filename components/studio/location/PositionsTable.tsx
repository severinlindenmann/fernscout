"use client";

import DayLineMap from "@/components/studio/location/DayLineMap";
import WorldMap from "@/components/WorldMap";
import { useI18n } from "@/components/LocaleProvider";
import { useState } from "react";
import type { Basemap } from "@/lib/basemap";

/**
 * One recorded day's own stored positions — B2563 T5, D11. Built server-side
 * (`[trip]/[date]/page.tsx`, from `ownerDayLine` plus `lib/gps/positionRows.ts`)
 * into already-localised display rows, so this file only renders, selects
 * and blurs — it never touches the store or a translation key that needs a
 * raw `TransportMode`.
 *
 * Coordinates are shown plain — B2568 dropped the earlier blur/reveal toggle
 * as unnecessary friction on the owner's own already-gated page.
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
/** A fix `spikeIndices` flagged as a one-point GPS glitch (B2568) — already
 *  localised into one line ("Set aside: 1.4 km jump in 1 s") server-side. */
type DisplaySpikeRow = { kind: "spike"; label: string };
export type DisplayRow = DisplayFixRow | DisplayGapRow | DisplaySpikeRow;

export default function PositionsTable({
  rows,
  points,
  gapAfter,
  region,
  streetMapsOn,
  timezone,
  summary,
  basemap = null,
}: {
  rows: DisplayRow[];
  points: [number, number][];
  gapAfter: boolean[];
  region?: { bounds: [[number, number], [number, number]]; url: string };
  streetMapsOn: boolean;
  timezone: string;
  summary: string;
  /** Server-derived from the day's own points (B2568) — this is a client
   *  component and cannot call `lib/basemap.ts` (`server-only`, `node:fs`)
   *  itself, so the plain-map fallback below would otherwise always draw a
   *  black box when `streetMapsOn` is off or this trip has no street tile. */
  basemap?: Basemap | null;
}) {
  const { t } = useI18n();
  const fixRows = rows.filter((r): r is DisplayFixRow => r.kind === "fix");
  const [selected, setSelected] = useState<number | null>(fixRows[0]?.index ?? null);

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
        basemap={basemap}
        track={[points]}
        frameHint={points.map(([lat, lng]) => ({ lat, lng }))}
        showTimeScrubber={false}
      />
    );

  return (
    <div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-ink-secondary">{summary}</span>
      </div>

      <div className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="overflow-x-auto rounded-xl border border-line-quiet">
          <table className="w-full text-sm md:min-w-[560px]">
            <thead>
              <tr className="border-b border-line-quiet text-left text-ink-secondary">
                <th className="px-3 py-2 font-semibold">{t("studio.location.positions.columns.time")}</th>
                <th className="hidden px-3 py-2 font-semibold md:table-cell">
                  {t("studio.location.positions.columns.lat")}
                </th>
                <th className="hidden px-3 py-2 font-semibold md:table-cell">
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
                row.kind === "gap" || row.kind === "spike" ? (
                  <tr key={`${row.kind}-${i}`} className="bg-surface-subtle">
                    <td colSpan={8} className="sticky left-0 px-3 py-2 text-left italic text-ink-secondary">
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
                    <td className="hidden px-3 py-2 tabular-nums md:table-cell">{row.lat.toFixed(5)}</td>
                    <td className="hidden px-3 py-2 tabular-nums md:table-cell">{row.lon.toFixed(5)}</td>
                    <td className="whitespace-nowrap px-3 py-2">{row.modeLabel ?? "–"}</td>
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
                <dd className="text-ink-body tabular-nums">
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
                <dd className="min-w-0 break-all font-mono text-xs text-ink-body">
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
