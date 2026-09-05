/**
 * Every country this instance might need to name, plus the two derived views
 * every picker over it wants — a flag with no image asset, and a name in the
 * reader's own language via the platform's own registry (`Intl.DisplayNames`).
 *
 * Lifted out of `TelField.tsx` (B385, widened by B390) when B398 needed the
 * same list and the same two helpers for a postal address's own country
 * field — one table, not two, so "Schweiz" reads the same whichever picker
 * wrote it.
 *
 * The dialling code (`cc`) travels with each row because `TelField` still
 * needs it; the postal address picker below simply ignores that column.
 * Several rows share a `cc` on purpose (`+1`, `+7`) — see `TelField.tsx`'s
 * own note on `DIAL_CODES`, which re-exports this table under its old name so
 * that component and its test are unchanged by the move.
 */
export const COUNTRIES: { iso2: string; cc: string }[] = [
  { iso2: "AD", cc: "376" }, { iso2: "AE", cc: "971" }, { iso2: "AF", cc: "93" },
  { iso2: "AG", cc: "1" }, { iso2: "AI", cc: "1" }, { iso2: "AL", cc: "355" },
  { iso2: "AM", cc: "374" }, { iso2: "AO", cc: "244" }, { iso2: "AQ", cc: "672" },
  { iso2: "AR", cc: "54" }, { iso2: "AS", cc: "1" }, { iso2: "AT", cc: "43" },
  { iso2: "AU", cc: "61" }, { iso2: "AW", cc: "297" }, { iso2: "AX", cc: "358" },
  { iso2: "AZ", cc: "994" }, { iso2: "BA", cc: "387" }, { iso2: "BB", cc: "1" },
  { iso2: "BD", cc: "880" }, { iso2: "BE", cc: "32" }, { iso2: "BF", cc: "226" },
  { iso2: "BG", cc: "359" }, { iso2: "BH", cc: "973" }, { iso2: "BI", cc: "257" },
  { iso2: "BJ", cc: "229" }, { iso2: "BL", cc: "590" }, { iso2: "BM", cc: "1" },
  { iso2: "BN", cc: "673" }, { iso2: "BO", cc: "591" }, { iso2: "BQ", cc: "599" },
  { iso2: "BR", cc: "55" }, { iso2: "BS", cc: "1" }, { iso2: "BT", cc: "975" },
  { iso2: "BW", cc: "267" }, { iso2: "BY", cc: "375" }, { iso2: "BZ", cc: "501" },
  { iso2: "CA", cc: "1" }, { iso2: "CC", cc: "61" }, { iso2: "CD", cc: "243" },
  { iso2: "CF", cc: "236" }, { iso2: "CG", cc: "242" }, { iso2: "CH", cc: "41" },
  { iso2: "CI", cc: "225" }, { iso2: "CK", cc: "682" }, { iso2: "CL", cc: "56" },
  { iso2: "CM", cc: "237" }, { iso2: "CN", cc: "86" }, { iso2: "CO", cc: "57" },
  { iso2: "CR", cc: "506" }, { iso2: "CU", cc: "53" }, { iso2: "CV", cc: "238" },
  { iso2: "CW", cc: "599" }, { iso2: "CX", cc: "61" }, { iso2: "CY", cc: "357" },
  { iso2: "CZ", cc: "420" }, { iso2: "DE", cc: "49" }, { iso2: "DJ", cc: "253" },
  { iso2: "DK", cc: "45" }, { iso2: "DM", cc: "1" }, { iso2: "DO", cc: "1" },
  { iso2: "DZ", cc: "213" }, { iso2: "EC", cc: "593" }, { iso2: "EE", cc: "372" },
  { iso2: "EG", cc: "20" }, { iso2: "EH", cc: "212" }, { iso2: "ER", cc: "291" },
  { iso2: "ES", cc: "34" }, { iso2: "ET", cc: "251" }, { iso2: "FI", cc: "358" },
  { iso2: "FJ", cc: "679" }, { iso2: "FK", cc: "500" }, { iso2: "FM", cc: "691" },
  { iso2: "FO", cc: "298" }, { iso2: "FR", cc: "33" }, { iso2: "GA", cc: "241" },
  { iso2: "GB", cc: "44" }, { iso2: "GD", cc: "1" }, { iso2: "GE", cc: "995" },
  { iso2: "GF", cc: "594" }, { iso2: "GG", cc: "44" }, { iso2: "GH", cc: "233" },
  { iso2: "GI", cc: "350" }, { iso2: "GL", cc: "299" }, { iso2: "GM", cc: "220" },
  { iso2: "GN", cc: "224" }, { iso2: "GP", cc: "590" }, { iso2: "GQ", cc: "240" },
  { iso2: "GR", cc: "30" }, { iso2: "GT", cc: "502" }, { iso2: "GU", cc: "1" },
  { iso2: "GW", cc: "245" }, { iso2: "GY", cc: "592" }, { iso2: "HK", cc: "852" },
  { iso2: "HN", cc: "504" }, { iso2: "HR", cc: "385" }, { iso2: "HT", cc: "509" },
  { iso2: "HU", cc: "36" }, { iso2: "ID", cc: "62" }, { iso2: "IE", cc: "353" },
  { iso2: "IL", cc: "972" }, { iso2: "IM", cc: "44" }, { iso2: "IN", cc: "91" },
  { iso2: "IO", cc: "246" }, { iso2: "IQ", cc: "964" }, { iso2: "IR", cc: "98" },
  { iso2: "IS", cc: "354" }, { iso2: "IT", cc: "39" }, { iso2: "JE", cc: "44" },
  { iso2: "JM", cc: "1" }, { iso2: "JO", cc: "962" }, { iso2: "JP", cc: "81" },
  { iso2: "KE", cc: "254" }, { iso2: "KG", cc: "996" }, { iso2: "KH", cc: "855" },
  { iso2: "KI", cc: "686" }, { iso2: "KM", cc: "269" }, { iso2: "KN", cc: "1" },
  { iso2: "KP", cc: "850" }, { iso2: "KR", cc: "82" }, { iso2: "KW", cc: "965" },
  { iso2: "KY", cc: "1" }, { iso2: "KZ", cc: "7" }, { iso2: "LA", cc: "856" },
  { iso2: "LB", cc: "961" }, { iso2: "LC", cc: "1" }, { iso2: "LI", cc: "423" },
  { iso2: "LK", cc: "94" }, { iso2: "LR", cc: "231" }, { iso2: "LS", cc: "266" },
  { iso2: "LT", cc: "370" }, { iso2: "LU", cc: "352" }, { iso2: "LV", cc: "371" },
  { iso2: "LY", cc: "218" }, { iso2: "MA", cc: "212" }, { iso2: "MC", cc: "377" },
  { iso2: "MD", cc: "373" }, { iso2: "ME", cc: "382" }, { iso2: "MF", cc: "590" },
  { iso2: "MG", cc: "261" }, { iso2: "MH", cc: "692" }, { iso2: "MK", cc: "389" },
  { iso2: "ML", cc: "223" }, { iso2: "MM", cc: "95" }, { iso2: "MN", cc: "976" },
  { iso2: "MO", cc: "853" }, { iso2: "MP", cc: "1" }, { iso2: "MQ", cc: "596" },
  { iso2: "MR", cc: "222" }, { iso2: "MS", cc: "1" }, { iso2: "MT", cc: "356" },
  { iso2: "MU", cc: "230" }, { iso2: "MV", cc: "960" }, { iso2: "MW", cc: "265" },
  { iso2: "MX", cc: "52" }, { iso2: "MY", cc: "60" }, { iso2: "MZ", cc: "258" },
  { iso2: "NA", cc: "264" }, { iso2: "NC", cc: "687" }, { iso2: "NE", cc: "227" },
  { iso2: "NF", cc: "672" }, { iso2: "NG", cc: "234" }, { iso2: "NI", cc: "505" },
  { iso2: "NL", cc: "31" }, { iso2: "NO", cc: "47" }, { iso2: "NP", cc: "977" },
  { iso2: "NR", cc: "674" }, { iso2: "NU", cc: "683" }, { iso2: "NZ", cc: "64" },
  { iso2: "OM", cc: "968" }, { iso2: "PA", cc: "507" }, { iso2: "PE", cc: "51" },
  { iso2: "PF", cc: "689" }, { iso2: "PG", cc: "675" }, { iso2: "PH", cc: "63" },
  { iso2: "PK", cc: "92" }, { iso2: "PL", cc: "48" }, { iso2: "PM", cc: "508" },
  { iso2: "PR", cc: "1" }, { iso2: "PS", cc: "970" }, { iso2: "PT", cc: "351" },
  { iso2: "PW", cc: "680" }, { iso2: "PY", cc: "595" }, { iso2: "QA", cc: "974" },
  { iso2: "RE", cc: "262" }, { iso2: "RO", cc: "40" }, { iso2: "RS", cc: "381" },
  { iso2: "RU", cc: "7" }, { iso2: "RW", cc: "250" }, { iso2: "SA", cc: "966" },
  { iso2: "SB", cc: "677" }, { iso2: "SC", cc: "248" }, { iso2: "SD", cc: "249" },
  { iso2: "SE", cc: "46" }, { iso2: "SG", cc: "65" }, { iso2: "SH", cc: "290" },
  { iso2: "SI", cc: "386" }, { iso2: "SJ", cc: "47" }, { iso2: "SK", cc: "421" },
  { iso2: "SL", cc: "232" }, { iso2: "SM", cc: "378" }, { iso2: "SN", cc: "221" },
  { iso2: "SO", cc: "252" }, { iso2: "SR", cc: "597" }, { iso2: "SS", cc: "211" },
  { iso2: "ST", cc: "239" }, { iso2: "SV", cc: "503" }, { iso2: "SX", cc: "1" },
  { iso2: "SY", cc: "963" }, { iso2: "SZ", cc: "268" }, { iso2: "TC", cc: "1" },
  { iso2: "TD", cc: "235" }, { iso2: "TG", cc: "228" }, { iso2: "TH", cc: "66" },
  { iso2: "TJ", cc: "992" }, { iso2: "TK", cc: "690" }, { iso2: "TL", cc: "670" },
  { iso2: "TM", cc: "993" }, { iso2: "TN", cc: "216" }, { iso2: "TO", cc: "676" },
  { iso2: "TR", cc: "90" }, { iso2: "TT", cc: "1" }, { iso2: "TV", cc: "688" },
  { iso2: "TW", cc: "886" }, { iso2: "TZ", cc: "255" }, { iso2: "UA", cc: "380" },
  { iso2: "UG", cc: "256" }, { iso2: "US", cc: "1" }, { iso2: "UY", cc: "598" },
  { iso2: "UZ", cc: "998" }, { iso2: "VA", cc: "379" }, { iso2: "VC", cc: "1" },
  { iso2: "VE", cc: "58" }, { iso2: "VG", cc: "1" }, { iso2: "VI", cc: "1" },
  { iso2: "VN", cc: "84" }, { iso2: "VU", cc: "678" }, { iso2: "WF", cc: "681" },
  { iso2: "WS", cc: "685" }, { iso2: "XK", cc: "383" }, { iso2: "YE", cc: "967" },
  { iso2: "YT", cc: "262" }, { iso2: "ZA", cc: "27" }, { iso2: "ZM", cc: "260" },
  { iso2: "ZW", cc: "263" },
];

/**
 * A country's flag from its ISO2 letters alone: each ASCII capital maps to a
 * Unicode regional-indicator symbol at a fixed offset, and a pair of them is
 * how every flag emoji is actually built. No asset, no request, and it works
 * offline the same as `Intl.DisplayNames` does.
 */
export function flagOf(iso2: string): string {
  return [...iso2.toUpperCase()]
    .map((letter) => String.fromCodePoint(letter.codePointAt(0)! - 65 + 0x1f1e6))
    .join("");
}

/**
 * A country's name in the given locale, via the platform's own registry —
 * the reason nobody hand-translated 240 names into en/de/hu. Falls back to
 * the bare code for a runtime with no name to give (or, in principle, a
 * locale `Intl.DisplayNames` rejects).
 */
export function countryName(iso2: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(iso2) ?? iso2;
  } catch {
    return iso2;
  }
}

/** Every country named in the given locale and sorted by that name — what a
 * plain country picker wants, as opposed to `TelField`'s own `filterCountries`
 * which also carries and searches the dial code. */
function namedCountries(locale: string): { iso2: string; name: string }[] {
  const named = COUNTRIES.map((c) => ({ iso2: c.iso2, name: countryName(c.iso2, locale) }));
  named.sort((a, b) => a.name.localeCompare(b.name, locale));
  return named;
}

/** The postal address's own country picker, narrowed to what `query` matches
 * (name or ISO2 code) the same way `TelField.filterCountries` does, minus the
 * dial-digit branch that has no meaning here. */
export function filterCountryList(query: string, locale: string): { iso2: string; name: string }[] {
  const named = namedCountries(locale);
  const q = query.trim().toLowerCase();
  if (q === "") return named;
  return named.filter((c) => c.name.toLowerCase().includes(q) || c.iso2.toLowerCase().includes(q));
}

/**
 * Resolve a stored `PostalAddress.country` string to an ISO2 code — B398's
 * read-time rule for a row written before this ticket. Case- and whitespace-
 * insensitive, tried against the bare code first and then against
 * `Intl.DisplayNames`' own name for every locale this journal speaks plus
 * English, so "CH", "Schweiz", "Switzerland" and "Suisse" all resolve to the
 * same country whichever of those a journal happens to offer.
 *
 * `null` for anything that does not land on an exact match — "Elbonia", or a
 * name in a language nobody asked `Intl.DisplayNames` for — and the caller
 * shows the stored text as typed with nothing selected, exactly as `splitTel`
 * leaves an unparseable phone number. Nothing here is a fuzzy match: a near
 * miss stays unresolved rather than guessed at.
 *
 * ponytail: first match wins rather than checking every code stays unique
 * under every locale tried — two territories that render identically in some
 * locale would resolve to whichever sorts first in `COUNTRIES`. Add a
 * uniqueness check if that ever turns out to matter for a real address.
 */
export function resolveCountry(stored: string, locales: string[]): string | null {
  const value = stored.trim().toLowerCase();
  if (value === "") return null;
  const byCode = COUNTRIES.find((c) => c.iso2.toLowerCase() === value);
  if (byCode) return byCode.iso2;
  const tried = [...new Set([...locales, "en"])];
  for (const country of COUNTRIES) {
    for (const locale of tried) {
      if (countryName(country.iso2, locale).trim().toLowerCase() === value) return country.iso2;
    }
  }
  return null;
}
