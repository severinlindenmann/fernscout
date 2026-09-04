"use client";

/**
 * The dialling-code half of a phone box — B385.
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
 * Countries this picker offers, by dialling code — not every country on
 * earth, honestly. It is the set this instance's own journals and their
 * guests have actually needed (Switzerland, its neighbours, the UK and
 * North America) plus Hungary, which already has a WhatsApp template
 * (`content/config.json`). Add a row when a real address needs one; a list
 * covering the ITU's full range would turn "pick your country" into its own
 * search problem.
 */
export const DIAL_CODES: { cc: string; label: string }[] = [
  { cc: "41", label: "Switzerland (+41)" },
  { cc: "49", label: "Germany (+49)" },
  { cc: "43", label: "Austria (+43)" },
  { cc: "33", label: "France (+33)" },
  { cc: "39", label: "Italy (+39)" },
  { cc: "34", label: "Spain (+34)" },
  { cc: "31", label: "Netherlands (+31)" },
  { cc: "32", label: "Belgium (+32)" },
  { cc: "44", label: "United Kingdom (+44)" },
  { cc: "1", label: "United States / Canada (+1)" },
  { cc: "36", label: "Hungary (+36)" },
];

/**
 * Read a stored `PostalAddress.tel` back into what this picker can show.
 *
 * A leading `+<cc>` is parsed only when `cc` is one of the codes above —
 * anything else (`076 561 31 50` with no `+`, or a country this picker does
 * not list) comes back with no country selected and the whole string left in
 * the digits box, exactly as typed. That is deliberate: a value this picker
 * cannot place is shown, not silently reinterpreted as some other country.
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
}: {
  /** Id of the digits `<input>` — kept on that element alone, so existing
   * lookups by id (tests included) still find the same field. */
  id: string;
  cc: string;
  national: string;
  onChange: (cc: string, national: string) => void;
  /** `t("contact.telCountry")` — the select has no visible label of its own,
   * so screen readers need one. */
  labelCountry: string;
}) {
  return (
    <div className="mt-2 flex gap-2">
      <select
        id={`${id}-cc`}
        aria-label={labelCountry}
        className={`${CONTROL} w-28 shrink-0`}
        value={cc}
        onChange={(e) => onChange(e.target.value, national)}
      >
        <option value="">+--</option>
        {DIAL_CODES.map((d) => (
          <option key={d.cc} value={d.cc}>
            +{d.cc}
          </option>
        ))}
      </select>
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
