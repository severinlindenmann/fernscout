"use client";

import { useI18n } from "@/components/LocaleProvider";

/**
 * The seven rows of the example file — an invented two-day walk along a
 * lake shore, signed. `public/examples/location-example.json` is these rows,
 * and `test/location-example.test.ts` holds the two together, and runs the
 * file through the real `fixes` importer and `checkGpsImporter`.
 */
export const LOCATION_EXAMPLE_ROWS = [
  { t: "2026-03-04T08:00:00Z", lat: 47.36667, lon: 8.545 },
  { t: "2026-03-04T09:15:00Z", lat: 47.3598, lon: 8.5512 },
  { t: "2026-03-04T10:30:00Z", lat: 47.3521, lon: 8.5587 },
  { t: "2026-03-04T12:00:00Z", lat: 47.345, lon: 8.566 },
  { t: "2026-03-05T08:30:00Z", lat: 47.338, lon: 8.573 },
  { t: "2026-03-05T09:45:00Z", lat: 47.331, lon: 8.58 },
  { t: "2026-03-05T11:00:00Z", lat: 47.324, lon: 8.587 },
] as const;

export const LOCATION_EXAMPLE_HREF = "/examples/location-example.json";

/**
 * "What the file looks like" — B2240. Modeled on `StatementSample.tsx`: the
 * example that lets somebody see the shape before they read the import
 * steps above. A plain JSON array of `{t, lat, lon}` rows is only one of the
 * shapes the `fixes` importer reads (JSON Lines and `[epochSeconds, lat, lon]`
 * rows work too, named in `formatNote`); a Google Timeline export or a GPX
 * file is read by its own importer, unchanged.
 */
export default function LocationSample() {
  const { t } = useI18n();
  const cell = "px-2 py-1.5 text-left";
  return (
    <section data-location-sample className="mt-6 rounded-2xl border border-line-strong bg-surface-subtle p-4">
      <h2 className="font-display text-base font-semibold text-ink-strong">{t("studio.location.sample.title")}</h2>
      <p className="mt-1 text-sm leading-6 text-ink-secondary">{t("studio.location.sample.lede")}</p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm text-ink-strong">
          <thead className="font-mono text-xs uppercase tracking-wide text-ink-secondary">
            <tr>
              <th className={cell}>{t("studio.location.sample.time")}</th>
              <th className={`${cell} text-right`}>{t("studio.location.sample.lat")}</th>
              <th className={`${cell} text-right`}>{t("studio.location.sample.lon")}</th>
            </tr>
          </thead>
          <tbody>
            {LOCATION_EXAMPLE_ROWS.map((row) => (
              <tr key={row.t} className="border-t border-line-quiet">
                <td className={`${cell} whitespace-nowrap font-mono text-xs`}>{row.t}</td>
                <td className={`${cell} text-right tabular-nums`}>{row.lat}</td>
                <td className={`${cell} text-right tabular-nums`}>{row.lon}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-sm leading-6 text-ink-secondary">{t("studio.location.sample.formatNote")}</p>
      <a
        href={LOCATION_EXAMPLE_HREF}
        download
        className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-ink-strong underline underline-offset-2"
      >
        {t("studio.location.sample.download")}
      </a>
    </section>
  );
}
