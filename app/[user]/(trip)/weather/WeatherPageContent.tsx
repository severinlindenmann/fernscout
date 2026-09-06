"use client";

import PageHeader from "@/components/PageHeader";
import { BarList, DailyColumns } from "@/components/charts/Charts";
import { useI18n } from "@/components/LocaleProvider";
import { SOURCE_CREDIT } from "@/lib/weather";
import type { WeatherSummary, WeatherExtreme } from "@/lib/weatherStats";
import type { TranslationKey } from "@/lib/i18n";

/**
 * A trip's weather, added up — B557.
 *
 * The page exists because B325 put a measured reading on every day and there
 * was nowhere for forty of them to go. Two rules carry over from the day-level
 * component (components/DayWeather.tsx) and shape everything here:
 *
 * **It says how many days it is speaking for.** Every figure on this page is
 * an average or a total over the days that carry a reading, and a trip may
 * have far fewer of those than days. The denominator is printed at the top,
 * before any of them, rather than left for a reader to assume.
 *
 * **It always says where the readings came from.** Every distinct source is
 * credited, and an archive's credit is a link because CC BY is a licence
 * condition rather than a courtesy. A trip mixing the server's own lookups
 * with a reading somebody took themselves credits both.
 */

const RAIN = "var(--color-sky-500)";
const WARM = "var(--color-coral-400)";
const COOL = "var(--color-sky-300)";

/** `−4°C`, with U+2212 rather than a hyphen — the same call DayWeather makes. */
function deg(n: number): string {
  return `${String(Math.round(n)).replace("-", "−")}°C`;
}

export default function WeatherPageContent({ summary }: { summary: WeatherSummary }) {
  const { t, tn, formatShortDate } = useI18n();

  const days = summary.measured + summary.missing;

  /**
   * The temperature band, one row per day.
   *
   * Not `DailyColumns`, which is the costs page's chart: it draws one value
   * from a zero baseline, and a temperature has two ends and a meaningful
   * negative. A day at −4 to −2 would have drawn as a 1px stub. This is the
   * same idea laid on its side — each day's band placed between the trip's
   * own coldest and warmest — and it is local to this page rather than in
   * components/charts, because one caller is not a shared component yet.
   */
  const band = summary.byDay.filter((d) => d.tempMin !== undefined || d.tempMax !== undefined);
  const lows = band.map((d) => d.tempMin ?? d.tempMax!);
  const highs = band.map((d) => d.tempMax ?? d.tempMin!);
  const floor = Math.min(...lows);
  const ceiling = Math.max(...highs);
  const span = ceiling - floor || 1;

  const rain = summary.byDay
    .filter((d) => d.precipitation !== undefined)
    .map((d) => ({ date: d.date, amount: d.precipitation! }));

  return (
    <div className="min-h-screen">
      <PageHeader />
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-navy-900 sm:text-4xl">
          {t("weatherPage.title")}
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-navy-600">{t("weatherPage.subtitle")}</p>

        {/* The denominator, before any figure that rests on it. */}
        <p className="mt-4 rounded-xl border border-navy-200 bg-white px-4 py-3 text-sm text-navy-600">
          {tn("weatherPage.measured", days, {
            measured: String(summary.measured),
            days: String(days),
          })}
          {summary.missing > 0 && (
            <> {tn("weatherPage.missing", summary.missing, { count: String(summary.missing) })}</>
          )}
        </p>

        <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {summary.avgHigh !== undefined && (
            <Stat label={t("weatherPage.avgHigh")} value={deg(summary.avgHigh)} hero />
          )}
          {summary.avgLow !== undefined && (
            <Stat label={t("weatherPage.avgLow")} value={deg(summary.avgLow)} />
          )}
          {summary.warmest && (
            <Stat
              label={t("weatherPage.warmest")}
              value={deg(summary.warmest.value)}
              sub={where(summary.warmest, formatShortDate)}
            />
          )}
          {summary.coldest && (
            <Stat
              label={t("weatherPage.coldest")}
              value={deg(summary.coldest.value)}
              sub={where(summary.coldest, formatShortDate)}
            />
          )}
        </dl>

        {summary.precipitationDays > 0 && (
          <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat
              label={t("weatherPage.precipitation")}
              value={`${summary.precipitation} mm`}
              sub={tn("weatherPage.overDays", summary.precipitationDays, {
                days: String(summary.precipitationDays),
              })}
            />
            <Stat
              label={t("weatherPage.wetDays")}
              value={String(summary.wetDays)}
              sub={tn("weatherPage.ofMeasured", summary.precipitationDays, {
                days: String(summary.precipitationDays),
              })}
            />
            {summary.wettest && summary.wettest.value > 0 && (
              <Stat
                label={t("weatherPage.wettest")}
                value={`${summary.wettest.value} mm`}
                sub={where(summary.wettest, formatShortDate)}
              />
            )}
            {summary.windiest && (
              <Stat
                label={t("weatherPage.windiest")}
                value={`${Math.round(summary.windiest.value)} km/h`}
                sub={where(summary.windiest, formatShortDate)}
              />
            )}
          </dl>
        )}

        {summary.byGroup.length > 0 && (
          <Section
            title={t("weatherPage.conditions")}
            /* Readings whose code we could not place are counted and said,
               never folded into the nearest group. A wrong picture is worse
               than no picture — the same call weatherGroup() makes. */
            note={
              summary.ungrouped > 0
                ? tn("weatherPage.ungrouped", summary.ungrouped, {
                    count: String(summary.ungrouped),
                  })
                : undefined
            }
          >
            <BarList
              rows={summary.byGroup.map((g) => ({
                key: g.group,
                label: t(`weather.${g.group}` as TranslationKey),
                value: g.days,
              }))}
              format={(n) => tn("weatherPage.dayCount", n, { count: String(n) })}
              accent={COOL}
            />
          </Section>
        )}

        {band.length > 0 && (
          <Section title={t("weatherPage.temperature")}>
            <ul className="flex flex-col gap-1">
              {band.map((d) => {
                const lo = d.tempMin ?? d.tempMax!;
                const hi = d.tempMax ?? d.tempMin!;
                return (
                  <li key={d.date} className="flex items-center gap-3 text-xs">
                    <span className="w-16 shrink-0 text-navy-600">{formatShortDate(d.date)}</span>
                    <span className="relative h-2.5 min-w-0 flex-1 rounded-full bg-navy-200/50">
                      <span
                        className="absolute inset-y-0 rounded-full"
                        style={{
                          left: `${((lo - floor) / span) * 100}%`,
                          right: `${((ceiling - hi) / span) * 100}%`,
                          minWidth: 4,
                          background: `linear-gradient(to right, ${COOL}, ${WARM})`,
                        }}
                      />
                    </span>
                    {/* Also the accessible reading of the bar beside it. */}
                    <span className="w-24 shrink-0 text-right tabular-nums text-navy-900">
                      {lo === hi ? deg(hi) : `${deg(lo)} – ${deg(hi)}`}
                    </span>
                  </li>
                );
              })}
            </ul>
          </Section>
        )}

        {rain.length > 0 && (
          <Section title={t("weatherPage.rainfall")}>
            <DailyColumns
              data={rain}
              average={summary.precipitation / rain.length}
              format={(n) => `${Math.round(n * 10) / 10} mm`}
              formatDate={formatShortDate}
              accent={RAIN}
            />
          </Section>
        )}

        <Credit sources={summary.sources} />
      </main>
    </div>
  );
}

/** Where and when, for a day singled out as the most something. */
function where(e: WeatherExtreme, formatShortDate: (d: string) => string): string {
  return `${e.location} · ${formatShortDate(e.date)}`;
}

/**
 * Who measured this.
 *
 * A linked credit means a public archive; plain text means a person's own
 * reading, shown exactly as they wrote it. That difference is the same one
 * DayWeather draws, and it is what lets a reader tell a measurement from
 * something somebody remembered.
 */
function Credit({ sources }: { sources: string[] }) {
  const { t } = useI18n();
  if (sources.length === 0) return null;
  return (
    <p className="mt-10 text-xs text-navy-600">
      {t("weatherPage.credit")}{" "}
      {sources.map((source, i) => {
        const credit = SOURCE_CREDIT[source];
        return (
          <span key={source}>
            {i > 0 && ", "}
            {credit ? (
              <a
                href={credit.href}
                target="_blank"
                rel="noreferrer nofollow"
                className="underline hover:text-navy-900"
              >
                {credit.label}
              </a>
            ) : (
              source
            )}
          </span>
        );
      })}
    </p>
  );
}

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10">
      <h2 className="font-display text-xl font-semibold text-navy-900">{title}</h2>
      {note && <p className="mt-1 text-xs text-navy-600">{note}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Stat({
  label,
  value,
  sub,
  hero = false,
}: {
  label: string;
  value: string;
  sub?: string;
  hero?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border px-4 py-3 ${
        hero ? "border-yellow-600/40 bg-yellow-400/25" : "border-navy-200 bg-white"
      }`}
    >
      <dt className="text-xs text-navy-600">{label}</dt>{" "}
      <dd className={`font-display font-semibold text-navy-900 ${hero ? "text-2xl" : "text-xl"}`}>
        {value}
        {sub && <> <span className="block text-xs font-normal text-navy-600">{sub}</span></>}
      </dd>
    </div>
  );
}
