"use client";

import { useEffect, useId, useRef, useState } from "react";
import { MIN_QUERY_LEN, type AddressSuggestion } from "@/lib/addressLookupTypes";

/** Waits for a pause in typing before asking the server — a keystroke is not
 * a search, and the four characters of "Bahn" should not cost four
 * requests. */
const DEBOUNCE_MS = 300;

/**
 * The street-and-number field, with real addresses on offer underneath it —
 * B399. Same combobox shape as `CountryField`, over the same input the
 * street was always typed into: no second field, because a suggestion is a
 * shortcut for what this box already asked for, never a different question.
 *
 * `enabled={false}` (the capability off, or the server has none configured)
 * makes this exactly the plain text field it always was — no debounce timer
 * runs, no request is ever made. All four callers pass it unconditionally
 * rather than branching between this and a bare `<input>`, so that arm of
 * the logic exists in one place.
 *
 * Nothing is sent until somebody types here: the query is `value`, and
 * `value` only ever comes from this field's own `onChange`.
 */
export default function AddressLookupField({
  id,
  value,
  onChange,
  onPick,
  enabled,
  username,
  locale,
  label,
  attribution,
  className,
  autoComplete,
}: {
  id: string;
  /** `address.line1` — read back exactly as `CountryField` reads `value`. */
  value: string;
  onChange: (value: string) => void;
  /** Fired when a suggestion is chosen. The field's own text updates via the
   * caller's next `value`, same as every other controlled field here. */
  onPick: (suggestion: AddressSuggestion) => void;
  /** `isEnabled("addressLookup", username)`, from the page. */
  enabled: boolean;
  username: string;
  /** The form's own locale — becomes Photon's `lang`, narrowed server-side
   * to what it actually supports. */
  locale: string;
  /** Accessible name for the listbox. */
  label: string;
  /** The ODbL attribution line — B416. Shown as a muted footer under the
   * suggestions, never above the field: it is only true once a query has
   * actually produced results, which is the same moment the attribution
   * obligation for showing them attaches. */
  attribution: string;
  className: string;
  autoComplete?: string;
}) {
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [highlight, setHighlight] = useState(0);
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  // Guards against a slow earlier request clobbering a faster later one —
  // the debounce already delays the *sending*, this covers the *answering*.
  const requestId = useRef(0);

  useEffect(() => {
    // Below the floor, there is nothing to ask — and nothing to clear
    // either: `showList` below already hides a stale list once the query
    // that produced it has shrunk under the threshold, so there is no
    // `setSuggestions([])` to fire here (`react-hooks/set-state-in-effect`
    // is right that one would be a synchronous setState-in-effect for no
    // reason: the next real query overwrites it before it would ever show).
    if (!enabled || value.trim().length < MIN_QUERY_LEN) return;
    const id = ++requestId.current;
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ user: username, q: value, locale });
      fetch(`/api/address-lookup?${params}`)
        .then((response) => (response.ok ? response.json() : { results: [] }))
        .then((body: { results?: AddressSuggestion[] }) => {
          if (requestId.current !== id) return;
          setSuggestions(body.results ?? []);
          setHighlight(0);
        })
        .catch(() => {
          if (requestId.current === id) setSuggestions([]);
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [enabled, value, username, locale]);

  // Same "click outside closes it" stand-in CountryField and TelField both
  // carry, for the same reason: a listbox has no native equivalent.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const showList =
    enabled && open && value.trim().length >= MIN_QUERY_LEN && suggestions.length > 0;

  function choose(suggestion: AddressSuggestion) {
    onPick(suggestion);
    setSuggestions([]);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!showList) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter" && suggestions[highlight]) {
      e.preventDefault();
      choose(suggestions[highlight]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="relative" ref={rootRef}>
      <input
        id={id}
        className={className}
        autoComplete={autoComplete}
        role={enabled ? "combobox" : undefined}
        aria-expanded={enabled ? showList : undefined}
        aria-controls={enabled ? listId : undefined}
        aria-autocomplete={enabled ? "list" : undefined}
        aria-label={enabled ? label : undefined}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {showList && (
        <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border border-navy-200 bg-white shadow-lg">
          <ul id={listId} role="listbox" aria-label={label} className="max-h-64 overflow-y-auto">
            {suggestions.map((suggestion, i) => (
              <li
                key={`${suggestion.line1}-${suggestion.postcode}-${suggestion.city}-${i}`}
                role="option"
                aria-selected={i === highlight}
                className={`cursor-pointer px-4 py-2 text-base ${i === highlight ? "bg-cream-100" : ""}`}
                // mousedown, not click — CountryField's own note applies here
                // too: it fires before the input's blur closes the list.
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(suggestion);
                }}
                onMouseEnter={() => setHighlight(i)}
              >
                {[suggestion.line1, `${suggestion.postcode} ${suggestion.city}`.trim(), suggestion.country]
                  .filter((part) => part !== "")
                  .join(", ")}
              </li>
            ))}
          </ul>
          {/* Attribution has to reach assistive tech, not just eyes — hiding
              it would silence the one signal a screen-reader user gets that a
              query left the server. Sitting outside the `<ul>`, after it, is
              what keeps it from being read as an option: nothing in here
              carries `role="option"` or an `aria-selected`, and `aria-controls`
              on the input still names only `listId`, the `<ul>` itself. */}
          <p className="border-t border-navy-100 px-4 py-1.5 text-xs text-navy-400">{attribution}</p>
        </div>
      )}
    </div>
  );
}
