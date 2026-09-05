"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { COUNTRIES, countryName, flagOf } from "@/lib/countries";

/**
 * The dialling-code half of a phone box — B385, made searchable and complete
 * by B390.
 *
 * `lib/whatsapp/phone.ts` refuses a national number (`076 561 31 50`) rather
 * than guess whose country it belongs to, and that refusal is right: the
 * guess would be made by a server, not by the person who actually knows the
 * answer. This picker asks the question at the one moment somebody who knows
 * the answer is present — when they are typing the number in — instead of
 * leaving it for `toE164` to fail on later, silently, at send time.
 *
 * One component, used from all four phone boxes in the product
 * (`ContactForm`, `ContactsAdmin`'s `GuestForm`, `InviteRedeem`,
 * `ContactManage`): four copies of a country list is four lists that drift.
 *
 * Storage is unchanged. What lands in `PostalAddress.tel` is still one
 * string, `+<cc> <national>` — the exact shape `toE164`'s `+` branch already
 * reads — so nothing downstream needed to change for this. `splitTel` and
 * `joinTel` below are the only new surface; everything else keeps writing and
 * reading that one field.
 */

/**
 * Every ISO 3166-1 alpha-2 territory this instance might get a number from,
 * paired with the dialling code it answers to. Deliberately **no name in
 * here** — B385's eleven-row table hand-wrote "Switzerland (+41)" for each
 * entry, which is exactly the work `Intl.DisplayNames` already does, in
 * every language this journal speaks, for free (see `countryName` below).
 *
 * Several rows share a `cc` on purpose — `+1` (US, Canada and a dozen
 * Caribbean nations), `+7` (Russia and Kazakhstan) — and that is unchanged
 * from B385: the stored value has only ever been able to say which *code*
 * was picked, never which country, and this ticket does not touch storage.
 * Uninhabited territories with no telecom of their own (the French Southern
 * Territories, Bouvet, Heard & McDonald, South Georgia) are left out — there
 * is no dial code for nobody to call.
 */
/**
 * B398 lifted the table itself, and `flagOf`/`countryName` with it, into
 * `lib/countries.ts` — the postal address's own country field needed the
 * same data. Re-exported under this component's original names so this file
 * and its test are otherwise unchanged by the move.
 */
export const DIAL_CODES = COUNTRIES;
export { countryName, flagOf };

/**
 * Every entry this picker offers, sorted by name and — when `query` is
 * non-empty — narrowed to what it matches: the name, the ISO2 code, or the
 * dial digits, so `swi`, `CH` and `41` all find Switzerland. Exported apart
 * from the component so it can be unit-tested without rendering anything
 * (this checkout has no DOM testing library — see `test/tel-field.test.ts`).
 */
export function filterCountries(
  query: string,
  locale: string,
): { iso2: string; cc: string; name: string }[] {
  const named = DIAL_CODES.map((d) => ({ ...d, name: countryName(d.iso2, locale) }));
  named.sort((a, b) => a.name.localeCompare(b.name, locale));
  const q = query.trim().toLowerCase();
  if (q === "") return named;
  const digits = q.replace(/^\+/, "");
  return named.filter(
    (d) =>
      d.name.toLowerCase().includes(q) ||
      d.iso2.toLowerCase().includes(q) ||
      (digits !== "" && d.cc.includes(digits)),
  );
}

/**
 * Read a stored `PostalAddress.tel` back into what this picker can show.
 *
 * A leading `+<cc>` is parsed only when `cc` is one of the codes above —
 * anything else (`076 561 31 50` with no `+`, or a code no ITU country
 * actually uses) comes back with no country selected and the whole string
 * left in the digits box, exactly as typed. That is deliberate: a value this
 * picker cannot place is shown, not silently reinterpreted as some other
 * country.
 */
export function splitTel(tel: string): { cc: string; national: string } {
  const trimmed = tel.trim();
  const match = /^\+(\d{1,3})\s*(.*)$/.exec(trimmed);
  if (match && DIAL_CODES.some((d) => d.cc === match[1])) {
    return { cc: match[1], national: match[2] };
  }
  return { cc: "", national: trimmed };
}

/**
 * The inverse of `splitTel`. No country picked yet stores the digits alone —
 * the same shape a legacy free-text row already had, and still refused by
 * `toE164` for exactly the reason it always was.
 */
export function joinTel(cc: string, national: string): string {
  const digits = national.trim();
  if (cc === "" || digits === "") return digits;
  return `+${cc} ${digits}`;
}

const CONTROL =
  "rounded-xl border border-navy-200 bg-white px-4 py-3 text-lg text-navy-900";

export default function TelField({
  id,
  cc,
  national,
  onChange,
  labelCountry,
  searchPlaceholder,
  noMatches,
  locale,
}: {
  /** Id of the digits `<input>` — kept on that element alone, so existing
   * lookups by id (tests included) still find the same field. */
  id: string;
  cc: string;
  national: string;
  onChange: (cc: string, national: string) => void;
  /** `t("contact.telCountry")` — the accessible name of the combobox; there
   * is no visible `<label>` of its own, same as the B385 `<select>` it
   * replaces. */
  labelCountry: string;
  /** `t("contact.telSearchPlaceholder")` — shown in the box until it holds a
   * selection or the person starts typing. */
  searchPlaceholder: string;
  /** `t("contact.telNoMatches")` — the one row shown when a filter matches
   * nothing (a stray "xx" more often than a real gap in `DIAL_CODES`). */
  noMatches: string;
  /** Which language to show country names in. Deliberately a prop rather
   * than `useI18n()`: two of this component's four callers (`ContactForm`,
   * `InviteRedeem`) hold the language in their own state instead of reading
   * `LocaleProvider`, on purpose (see `ContactForm`'s doc comment) — the
   * form's own language is the one the person filling it in is reading
   * everything else in, and it is what every caller already has on hand. */
  locale: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => filterCountries(query, locale), [query, locale]);
  // Several rows share a `cc` (`+1`, `+7`); this can only show the first
  // match by name, which is fine — the field never stored which one was
  // meant, before this ticket or after it.
  const selected = useMemo(
    () => filterCountries("", locale).find((d) => d.cc === cc),
    [cc, locale],
  );
  const active = filtered[Math.min(highlight, filtered.length - 1)];

  // A listbox has no native "click outside to close" the way a <select>'s
  // own popup does; this is the one line standing in for it.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  function choose(d: { iso2: string; cc: string }) {
    onChange(d.cc, national);
    setQuery("");
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      if (open && active) {
        e.preventDefault();
        choose(active);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setQuery("");
    }
  }

  const displayValue = open
    ? query
    : selected
      ? `${flagOf(selected.iso2)} ${selected.name} (+${selected.cc})`
      : "";

  return (
    <div className="mt-2 flex gap-2">
      <div className="relative w-64 shrink-0" ref={rootRef}>
        <input
          id={`${id}-cc`}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label={labelCountry}
          aria-activedescendant={open && active ? `${listId}-${active.iso2}` : undefined}
          className={`${CONTROL} w-full`}
          placeholder={searchPlaceholder}
          autoComplete="off"
          value={displayValue}
          onFocus={() => {
            setOpen(true);
            setQuery("");
            setHighlight(0);
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setHighlight(0);
          }}
          onKeyDown={onKeyDown}
        />
        {open && (
          <ul
            id={listId}
            role="listbox"
            aria-label={labelCountry}
            className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-navy-200 bg-white shadow-lg"
          >
            {filtered.length === 0 && (
              <li className="px-4 py-2 text-base text-navy-600">{noMatches}</li>
            )}
            {filtered.map((d, i) => (
              <li
                key={d.iso2}
                id={`${listId}-${d.iso2}`}
                role="option"
                aria-selected={i === highlight}
                className={`cursor-pointer px-4 py-2 text-base ${
                  i === highlight ? "bg-cream-100" : ""
                }`}
                // mousedown, not click: it fires before the input's blur, so
                // choosing an option does not first close the list on blur
                // and then land on nothing.
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(d);
                }}
                onMouseEnter={() => setHighlight(i)}
              >
                {flagOf(d.iso2)} {d.name} (+{d.cc})
              </li>
            ))}
          </ul>
        )}
      </div>
      <input
        id={id}
        className={`${CONTROL} flex-1`}
        type="tel"
        autoComplete="tel"
        value={national}
        onChange={(e) => onChange(cc, e.target.value)}
      />
    </div>
  );
}
