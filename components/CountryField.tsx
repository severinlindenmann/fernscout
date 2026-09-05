"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { filterCountryList, flagOf, resolveCountry } from "@/lib/countries";

/**
 * The searchable country picker for a postal address — B398.
 *
 * Same combobox pattern as `TelField`'s own dialling-code half (B385/B390):
 * one input, a filtered listbox under it, arrow keys and Enter to choose. No
 * second copy of that interaction was worth building for one fewer column
 * (no dial code), so this is a sibling component rather than a shared one —
 * `TelField` pairs its country with a digits box that has no equivalent here.
 *
 * **Legacy rows.** `value` is `PostalAddress.country` exactly as stored — a
 * fresh ISO2 code, or whatever somebody typed before this ticket ("Schweiz",
 * "Switzerland", free text). `resolveCountry` (see `lib/countries.ts`) tries
 * to place it against the journal's own languages plus English; when it
 * resolves, that country shows selected. When it does not, `value` is shown
 * as typed and nothing is selected — the same rule `splitTel` uses for a
 * phone number this picker cannot place. Either way `value` is left alone
 * until `onChange` fires: opening the picker and closing it again without
 * choosing anything must not rewrite an unresolved string into a guess.
 */
export default function CountryField({
  id,
  value,
  locales,
  onChange,
  label,
  searchPlaceholder,
  noMatches,
  locale,
}: {
  id: string;
  /** `PostalAddress.country`, as stored — see the note above. */
  value: string;
  /** The languages this journal offers, for resolving a legacy string. */
  locales: string[];
  onChange: (code: string) => void;
  /** `t("contact.addrCountry")` — the accessible name of the combobox. */
  label: string;
  /** `t("contact.addrCountrySearchPlaceholder")`. */
  searchPlaceholder: string;
  /** `t("contact.addrCountryNoMatches")`. */
  noMatches: string;
  /** Which language to show country names in — the form's own, same as
   * `TelField`'s `locale` prop. */
  locale: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => filterCountryList(query, locale), [query, locale]);
  const resolvedCode = useMemo(() => resolveCountry(value, locales), [value, locales]);
  const selected = useMemo(
    () => (resolvedCode ? filterCountryList("", locale).find((c) => c.iso2 === resolvedCode) : undefined),
    [resolvedCode, locale],
  );
  const active = filtered[Math.min(highlight, filtered.length - 1)];

  // A listbox has no native "click outside to close" the way a <select>'s
  // own popup does; this is the one line standing in for it — copied from
  // `TelField`, which has the same need.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  function choose(c: { iso2: string }) {
    onChange(c.iso2);
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

  const displayValue = open ? query : selected ? `${flagOf(selected.iso2)} ${selected.name}` : value;

  return (
    <div className="relative mt-2" ref={rootRef}>
      <input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label={label}
        aria-activedescendant={open && active ? `${listId}-${active.iso2}` : undefined}
        className="w-full rounded-xl border border-navy-200 bg-white px-4 py-3 text-lg text-navy-900"
        placeholder={searchPlaceholder}
        autoComplete="country-name"
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
          aria-label={label}
          className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-navy-200 bg-white shadow-lg"
        >
          {filtered.length === 0 && (
            <li className="px-4 py-2 text-base text-navy-600">{noMatches}</li>
          )}
          {filtered.map((c, i) => (
            <li
              key={c.iso2}
              id={`${listId}-${c.iso2}`}
              role="option"
              aria-selected={i === highlight}
              className={`cursor-pointer px-4 py-2 text-base ${
                i === highlight ? "bg-cream-100" : ""
              }`}
              // mousedown, not click: see TelField's own note — it fires
              // before the input's blur, so choosing an option does not
              // first close the list on blur and then land on nothing.
              onMouseDown={(e) => {
                e.preventDefault();
                choose(c);
              }}
              onMouseEnter={() => setHighlight(i)}
            >
              {flagOf(c.iso2)} {c.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
