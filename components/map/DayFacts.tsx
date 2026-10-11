"use client";

import { Camera, FileText, Route, Wallet } from "lucide-react";
import { useI18n } from "@/components/LocaleProvider";
import { useTrip } from "@/components/TripProvider";
import { useOptionalMoney } from "@/components/CurrencyProvider";
import { budgetFact, daySpend, formatKm, weatherFact, type WeatherFact } from "@/lib/map/dayFacts";
import type { MapDay } from "@/lib/map/mapDays";
import type { DayWeather } from "@/lib/weather";

/** The stored reading as chip text and a truthful label ("Clear, 12° – 19°C. Weather recorded by X, 3 Oct"). */
export function useWeatherText(weather: DayWeather | undefined): { fact: WeatherFact; chip: string; label: string } | null {
  const { t, formatLongDate } = useI18n();
  const units = useTrip()?.units;
  const fact = weatherFact(weather, units);
  if (!fact || !weather) return null;
  // Literal keys so the locale scope ships them to this page.
  const names = {
    clear: t("weather.clear"),
    partly: t("weather.partly"),
    cloudy: t("weather.cloudy"),
    fog: t("weather.fog"),
    rain: t("weather.rain"),
    snow: t("weather.snow"),
    thunder: t("weather.thunder"),
  };
  const what = fact.group ? names[fact.group] : t("weather.unknown");
  const via = t("weather.via", { source: fact.source, when: formatLongDate(weather.recordedAt.slice(0, 10)) });
  return {
    fact,
    chip: [fact.glyph, fact.temp].filter(Boolean).join(" "),
    label: `${what}${fact.temp ? `, ${fact.temp}` : ""}. ${via}`,
  };
}

const CHIP = "inline-flex items-center gap-1 rounded-full border border-line-quiet bg-surface-raised px-2 py-0.5 text-xs text-ink-body";

/**
 * What a day card states before it is read: posts, photographs, recorded
 * distance, the stored weather and spend. Each chip appears only when its
 * figure exists; the weather chip always carries its source in its label.
 * `tripCost` (the trip's total, in the base currency) is shown only in the reader.
 */
export default function DayFacts({
  day,
  km,
  tripCost,
  className = "",
}: {
  day: MapDay;
  /** Kilometres recorded on this day, when any were. */
  km?: number;
  tripCost?: number;
  className?: string;
}) {
  const { t, tn } = useI18n();
  const money = useOptionalMoney();
  const weather = useWeatherText(day.weather);
  const budget = money ? budgetFact(day.cost, tripCost, (n) => money.money(n)) : null;
  const spend =
    money &&
    daySpend(day, {
      money: (n) => money.money(n),
      original: money.original,
      single: day.cost ? money.spendParts(day.cost, day.costLocal).paid : undefined,
    });
  const distance = km !== undefined ? formatKm(km) : null;

  return (
    <ul className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      {day.updates > 0 && (
        <li className={CHIP}>
          <FileText className="h-3 w-3" aria-hidden />
          {tn("map.facts.posts", day.updates, { count: String(day.updates) })}
        </li>
      )}
      {day.mediaCount > 0 && (
        <li className={CHIP}>
          <Camera className="h-3 w-3" aria-hidden />
          {tn("map.facts.photos", day.mediaCount, { count: String(day.mediaCount) })}
        </li>
      )}
      {distance && (
        <li className={CHIP}>
          <Route className="h-3 w-3" aria-hidden />
          {distance}
        </li>
      )}
      {weather && (
        <li className={CHIP} title={weather.label} aria-label={weather.label}>
          <span aria-hidden>{weather.chip}</span>
        </li>
      )}
      {(budget || spend) && (
        <li className={CHIP} title={t("cost.today")}>
          <Wallet className="h-3 w-3" aria-hidden />
          {spend?.text}
          {spend?.converted && <span className="text-[10px] text-ink-secondary">{t("cost.convertedMark")}</span>}
          {budget?.trip && (spend || budget.day) ? ` · ${t("cost.total")} ${budget.trip}` : budget?.trip ? `${t("cost.total")} ${budget.trip}` : ""}
        </li>
      )}

    </ul>
  );
}
