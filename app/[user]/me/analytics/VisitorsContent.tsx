"use client";

import Link from "next/link";
import { Eye, Images, Users } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { useI18n } from "@/components/LocaleProvider";
import type { VisitorReport } from "@/lib/analytics/report";

/**
 * The owner's view of their readers — B566.
 *
 * ## Two numbers, never one
 *
 * Every figure here is a pair: **opens** and **people**. One alone always
 * misleads. Opens on their own turn one person refreshing into an audience;
 * people on their own hide that somebody sat down and read the whole trip.
 *
 * ## The paragraph at the bottom is not boilerplate
 *
 * A "visitor" here is one day of one internet address, and the owner is going
 * to be asked by their family what this page is. Printing the method next to
 * the number is what makes the number usable: somebody who knows uniques are a
 * floor will not read a flat week as indifference. A figure whose limits are
 * hidden is a figure that gets over-read, and this one is about people the
 * owner knows personally.
 */

export default function VisitorsContent({
  report,
  base,
  windows,
  retentionDays,
}: {
  report: VisitorReport;
  base: string;
  windows: number[];
  retentionDays: number;
}) {
  const { t } = useI18n();

  const gallery = report.kinds.find((k) => k.kind === "gallery");
  // The busiest day sets the height of every bar, so the shape is comparable
  // across the row. `|| 1` keeps an empty window from dividing by zero.
  const peak = Math.max(1, ...report.perDay.map((d) => d.opens));

  return (
    <div className="min-h-screen">
      <PageHeader />
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-navy-900 sm:text-4xl">
          {t("visitors.title")}
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-navy-600">{t("visitors.subtitle")}</p>

        <div className="mt-6 flex flex-wrap gap-2">
          {windows.map((d) => (
            <Link
              key={d}
              href={`${base}/me/analytics?days=${d}`}
              aria-current={d === report.days ? "page" : undefined}
              className={
                d === report.days
                  ? "inline-flex min-h-11 items-center rounded-full bg-navy-900 px-4 text-sm font-semibold text-white"
                  : "inline-flex min-h-11 items-center rounded-full border border-navy-200 bg-white px-4 text-sm font-semibold text-navy-700 transition-colors hover:border-navy-400"
              }
            >
              {t("visitors.lastDays").replace("{days}", String(d))}
            </Link>
          ))}
        </div>

        {report.opens === 0 ? (
          /* Nothing yet is a sentence, not a grid of zeroes — B76. A journal
             the day after this is switched on has no readers *recorded*,
             which is a different claim from having no readers. */
          <p className="mt-8 rounded-2xl border border-navy-200 bg-white p-6 text-base text-navy-700">
            {t("visitors.empty")}
          </p>
        ) : (
          <>
            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              <Stat Icon={Eye} label={t("visitors.opens")} value={report.opens} />
              <Stat Icon={Users} label={t("visitors.people")} value={report.visitors} />
              <Stat
                Icon={Images}
                label={t("visitors.galleryOpens")}
                value={gallery?.opens ?? 0}
              />
            </div>

            <section className="mt-8">
              <h2 className="font-display text-lg font-semibold text-navy-900">
                {t("visitors.overTime")}
              </h2>
              {/* A row of bars rather than a charting library: this is one
                  series of at most ninety integers, and `div` with a height
                  is the whole implementation. The table below it is what a
                  screen reader gets — the bars are aria-hidden. */}
              <ol
                aria-hidden
                className="mt-3 flex h-32 items-end gap-[2px] overflow-x-auto rounded-2xl border border-navy-200 bg-white p-3"
              >
                {report.perDay.map((d) => (
                  <li
                    key={d.day}
                    title={`${d.day} — ${d.opens}`}
                    style={{ height: `${Math.max(4, (d.opens / peak) * 100)}%` }}
                    className="w-2 shrink-0 rounded-t bg-yellow-400"
                  />
                ))}
              </ol>
              <Table
                caption={t("visitors.overTime")}
                head={[t("visitors.day"), t("visitors.opens"), t("visitors.people")]}
                rows={report.perDay.map((d) => [d.day, d.opens, d.visitors])}
              />
            </section>

            {report.trips.length > 0 && (
              <section className="mt-8">
                <h2 className="font-display text-lg font-semibold text-navy-900">
                  {t("visitors.byTrip")}
                </h2>
                <Table
                  head={[t("visitors.trip"), t("visitors.opens"), t("visitors.people")]}
                  rows={report.trips.map((r) => [r.label, r.opens, r.visitors])}
                />
              </section>
            )}

            {report.entries.length > 0 && (
              <section className="mt-8">
                <h2 className="font-display text-lg font-semibold text-navy-900">
                  {t("visitors.byDay")}
                </h2>
                <Table
                  head={[t("visitors.entry"), t("visitors.opens"), t("visitors.people")]}
                  rows={report.entries.map((r) => [r.label, r.opens, r.visitors])}
                />
              </section>
            )}
          </>
        )}

        <section className="mt-10 rounded-2xl border border-navy-200 bg-sky-50/50 p-5 sm:p-6">
          <h2 className="font-display text-lg font-semibold text-navy-900">
            {t("visitors.howTitle")}
          </h2>
          <p className="mt-2 text-sm leading-6 text-navy-700">{t("visitors.howBody")}</p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm leading-6 text-navy-700">
            <li>{t("visitors.howNoReturning")}</li>
            <li>{t("visitors.howFloor")}</li>
            <li>{t("visitors.howExcluded")}</li>
            <li>{t("visitors.howRetention").replace("{days}", String(retentionDays))}</li>
          </ul>
        </section>
      </main>
    </div>
  );
}

function Stat({
  Icon,
  label,
  value,
}: {
  Icon: typeof Eye;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-2xl border border-navy-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2 text-navy-600">
        <Icon className="h-4 w-4" strokeWidth={2.2} aria-hidden />
        <h2 className="text-sm font-semibold">{label}</h2>
      </div>
      <p className="mt-2 font-display text-3xl font-semibold text-navy-900">{value}</p>
    </div>
  );
}

function Table({
  caption,
  head,
  rows,
}: {
  caption?: string;
  head: string[];
  rows: (string | number)[][];
}) {
  return (
    <div className="mt-3 overflow-x-auto rounded-2xl border border-navy-200 bg-white">
      <table className="w-full text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr className="border-b border-navy-200 text-left text-navy-600">
            {head.map((h, i) => (
              <th key={h} scope="col" className={i === 0 ? "px-4 py-2" : "px-4 py-2 text-right"}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={String(r[0])} className="border-b border-navy-100 last:border-0">
              {r.map((cell, i) => (
                <td
                  key={i}
                  className={
                    i === 0
                      ? "px-4 py-2 text-navy-900"
                      : "px-4 py-2 text-right tabular-nums text-navy-700"
                  }
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
