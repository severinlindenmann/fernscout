"use client";

import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import BusyButton from "@/components/BusyButton";
import CountryField from "@/components/CountryField";
import { useI18n } from "@/components/LocaleProvider";
import { mediaLoader } from "@/components/mediaLoader";
import { useSite } from "@/components/SiteProvider";
import VisitedSheet from "@/components/VisitedSheet";
import { countryName } from "@/lib/countries";
import { monthNames } from "@/lib/i18n";
import type { TripVisibility } from "@/lib/types";
import type { VisitedCardData } from "@/lib/visitedCards";

const inputClass =
  "mt-1.5 min-h-11 w-full rounded-xl border border-line-quiet bg-surface-raised px-3 py-2 text-base text-ink-strong";
const labelClass = "block text-sm font-semibold text-ink-strong";
const FIRST_YEAR = 1900;

/** What the web door answers with, as the page's own card data. */
type Doc = {
  country: string;
  places?: string;
  year?: number;
  month?: number;
  note?: string;
  photo?: { url: string };
  visibility: TripVisibility;
};

function cardOf(doc: Doc, locale: string): VisitedCardData {
  return {
    code: doc.country,
    name: countryName(doc.country, locale),
    places: doc.places,
    year: doc.year,
    month: doc.month,
    note: doc.note,
    photo: doc.photo?.url,
    visibility: doc.visibility,
  };
}

/**
 * Add a country without a trip, or edit one (B2914) — the owner's own sheet.
 * Only the country is required; places are free text (no geocoder), the date
 * is a month and year or a year alone, one photograph goes through the
 * ordinary upload once the entry exists, and the audience starts at Guests.
 * Choosing a country that already has an entry opens that entry instead of
 * making a second.
 */
export default function VisitedForm({
  initial,
  choices,
  entries,
  onSwitch,
  onChecklist,
  onClose,
}: {
  /** Set when editing; the country is then fixed. */
  initial?: VisitedCardData;
  /** Every country the map can draw — the codes a POST will accept. */
  choices: { code: string; continent: string }[];
  /** Entries that exist, by country, so a repeat pick opens the one there. */
  entries: Map<string, VisitedCardData>;
  onSwitch: (entry: VisitedCardData) => void;
  onChecklist: () => void;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const { username, locales } = useSite();
  const router = useRouter();
  const editing = Boolean(initial);
  const [code, setCode] = useState(initial?.code ?? "");
  const [places, setPlaces] = useState(initial?.places ?? "");
  const [year, setYear] = useState(initial?.year ? String(initial.year) : "");
  const [month, setMonth] = useState(initial?.month ? String(initial.month) : "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [visibility, setVisibility] = useState<TripVisibility>(initial?.visibility ?? "guest");
  const [file, setFile] = useState<File | null>(null);
  const [dropPhoto, setDropPhoto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set once the entry is written but its photograph was not, so a second
  // press patches rather than adds.
  const [written, setWritten] = useState(false);

  const door = `/api/web/${encodeURIComponent(username)}/visited`;
  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: thisYear - FIRST_YEAR + 1 }, (_, i) => thisYear - i);
  const valid = choices.some((c) => c.code === code);
  const name = valid ? countryName(code, locale) : "";

  function pick(next: string) {
    setError(null);
    if (!choices.some((c) => c.code === next)) {
      setError(t("visited.errorCountry"));
      return;
    }
    const existing = entries.get(next);
    if (existing && !editing) onSwitch(existing);
    else setCode(next);
  }

  async function save() {
    if (!valid) return;
    setBusy(true);
    setError(null);
    const y = year ? Number(year) : undefined;
    const m = y && month ? Number(month) : undefined;
    try {
      if (editing || written) {
        const res = await fetch(`${door}/${code}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            places: places.trim() || null,
            year: y ?? null,
            month: m ?? null,
            note: note.trim() || null,
            visibility,
          }),
        });
        if (!res.ok) throw new Error("save");
      } else {
        const res = await fetch(door, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            country: code,
            ...(places.trim() ? { places: places.trim() } : {}),
            ...(y ? { year: y } : {}),
            ...(m ? { month: m } : {}),
            ...(note.trim() ? { note: note.trim() } : {}),
            visibility,
          }),
        });
        if (!res.ok) throw new Error("save");
        if (res.status === 200) {
          // Somebody (this owner, elsewhere) added it first: nothing was
          // overwritten, so open what is there.
          router.refresh();
          onSwitch(cardOf((await res.json()) as Doc, locale));
          return;
        }
        setWritten(true);
      }
      if (file) {
        const form = new FormData();
        form.append("file", file);
        const up = await fetch(`${door}/${code}/photo`, { method: "PUT", body: form });
        if (!up.ok) {
          router.refresh();
          setFile(null);
          setError(t("visited.errorPhoto"));
          setBusy(false);
          return;
        }
      } else if (editing && dropPhoto && initial?.photo) {
        await fetch(`${door}/${code}/photo`, { method: "DELETE" });
      }
      router.refresh();
      onClose();
    } catch {
      setError(t("visited.errorGeneric"));
      setBusy(false);
    }
  }

  return (
    <VisitedSheet
      title={editing ? t("visited.editTitle", { country: initial!.name }) : t("visited.add")}
      onClose={onClose}
      footer={
        <>
          {error && (
            <p role="alert" className="mb-2 text-sm text-coral-600">
              {error}
            </p>
          )}
          <BusyButton
            busy={busy}
            type="button"
            disabled={!valid}
            onClick={() => void save()}
            className="min-h-11 w-full rounded-full bg-ink-strong px-5 text-base font-semibold text-surface-raised disabled:opacity-50"
          >
            {busy
              ? t("visited.saving")
              : editing || written
                ? t("visited.save")
                : valid
                  ? t("visited.submitAdd", { country: name })
                  : t("visited.submitAddBare")}
          </BusyButton>
        </>
      }
    >
      <div className="space-y-5 px-5 py-4">
        <p className="text-sm text-ink-secondary">{t("visited.intro")}</p>

        <div>
          <label htmlFor="visited-country" className={labelClass}>
            {t("visited.country")}
          </label>
          {editing ? (
            <p className="mt-1.5 text-lg text-ink-strong">
              {name}
            </p>
          ) : (
            <CountryField
              id="visited-country"
              value={code}
              locales={locales}
              onChange={pick}
              label={t("visited.country")}
              searchPlaceholder={t("visited.countrySearch")}
              noMatches={t("visited.countryNone")}
              locale={locale}
            />
          )}
        </div>

        <div>
          <label htmlFor="visited-places" className={labelClass}>
            {t("visited.places")} <span className="font-normal text-ink-secondary">· {t("visited.optional")}</span>
          </label>
          <input
            id="visited-places"
            className={inputClass}
            value={places}
            maxLength={200}
            onChange={(e) => setPlaces(e.target.value)}
          />
        </div>

        <fieldset>
          <legend className={labelClass}>
            {t("visited.when")} <span className="font-normal text-ink-secondary">· {t("visited.optional")}</span>
          </legend>
          <div className="mt-1.5 grid grid-cols-2 gap-3">
            <label className="text-xs text-ink-secondary">
              {t("visited.month")}
              <select
                className={inputClass}
                value={month}
                disabled={!year}
                onChange={(e) => setMonth(e.target.value)}
              >
                <option value="" />
                {monthNames(locale).map((label, i) => (
                  <option key={label} value={i + 1}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-ink-secondary">
              {t("visited.year")}
              <select
                className={inputClass}
                value={year}
                onChange={(e) => {
                  setYear(e.target.value);
                  if (!e.target.value) setMonth("");
                }}
              >
                <option value="" />
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </fieldset>

        <div>
          <label htmlFor="visited-photo" className={labelClass}>
            {t("visited.photo")} <span className="font-normal text-ink-secondary">· {t("visited.optional")}</span>
          </label>
          {editing && initial?.photo && !dropPhoto && !file && (
            <div className="mt-1.5 flex items-center gap-3">
              <span className="relative block h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-surface-muted">
                <Image src={initial.photo} loader={mediaLoader} alt="" fill sizes="64px" className="object-cover" />
              </span>
              <button
                type="button"
                onClick={() => setDropPhoto(true)}
                className="min-h-11 rounded-full border border-line-strong px-4 text-sm font-semibold text-ink-body hover:bg-surface-subtle"
              >
                {t("visited.photoRemove")}
              </button>
            </div>
          )}
          <input
            id="visited-photo"
            type="file"
            accept="image/*"
            className="mt-1.5 block min-h-11 w-full text-sm text-ink-body file:mr-3 file:min-h-11 file:rounded-full file:border-0 file:bg-surface-muted file:px-4 file:font-semibold file:text-ink-strong"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <p className="mt-1 text-xs text-ink-secondary">{t("visited.photoHint")}</p>
        </div>

        <div>
          <label htmlFor="visited-note" className={labelClass}>
            {t("visited.note")} <span className="font-normal text-ink-secondary">· {t("visited.optional")}</span>
          </label>
          <textarea
            id="visited-note"
            className={inputClass}
            rows={3}
            maxLength={1000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        <div>
          <label htmlFor="visited-visibility" className={labelClass}>
            {t("visited.who")}
          </label>
          <select
            id="visited-visibility"
            className={inputClass}
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as TripVisibility)}
          >
            <option value="guest">{t("visibility.guest")}</option>
            <option value="private">{t("visibility.private")}</option>
            <option value="public">{t("visibility.public")}</option>
          </select>
        </div>

        {!editing && (
          <button
            type="button"
            onClick={onChecklist}
            className="min-h-11 text-sm text-ink-secondary underline underline-offset-4 hover:text-ink-strong"
          >
            {t("visited.several")}
          </button>
        )}
      </div>
    </VisitedSheet>
  );
}
