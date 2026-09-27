"use client";

import type { ReactNode } from "react";
import AddressLookupField from "@/components/AddressLookupField";
import CountryField from "@/components/CountryField";

/**
 * The pieces the welcome guide (`/w/`) and the join flow (`/j/`) share —
 * B2293. Phone-first: one column, the primary button at the bottom within
 * thumb reach, 44px targets, brand tokens only (yellow-400 carries navy-900
 * text; focus stays blue-500 from the global ring).
 */

export const PRIMARY =
  "min-h-13 w-full rounded-2xl bg-yellow-400 px-5 py-3 text-lg font-semibold text-navy-900 transition-colors hover:bg-yellow-300 disabled:opacity-50";
export const SECONDARY =
  "min-h-13 w-full rounded-2xl border border-line-ink bg-surface-raised px-5 py-3 text-lg font-semibold text-ink-strong hover:bg-surface-subtle disabled:opacity-50";
export const QUIET =
  "min-h-11 self-center px-2 text-base font-semibold text-ink-strong underline underline-offset-2 disabled:opacity-50";
export const FIELD =
  "mt-1 min-h-12 w-full rounded-xl border border-line-strong bg-surface-raised px-3 text-base text-ink-strong";
export const LABEL = "block text-sm font-semibold text-ink-strong";

/** One screen: content on top, the dots and the buttons at the bottom. */
export function Screen({
  children,
  footer,
  dots,
  labelledBy,
}: {
  children: ReactNode;
  footer: ReactNode;
  dots?: { total: number; current: number; label: string };
  labelledBy: string;
}) {
  return (
    <section aria-labelledby={labelledBy} className="flex min-h-[calc(100dvh-4rem)] flex-col gap-4">
      {children}
      <div className="mt-auto flex flex-col gap-3 pt-4">
        {dots && dots.total > 1 && <Dots {...dots} />}
        {footer}
      </div>
    </section>
  );
}

export function Heading({ id, children, big = false }: { id: string; children: ReactNode; big?: boolean }) {
  return (
    <h1 id={id} tabIndex={-1} className={`quiet-inner-focus font-display font-semibold leading-tight text-ink-strong ${big ? "text-3xl" : "text-2xl"}`}>
      {children}
    </h1>
  );
}

function Dots({ total, current, label }: { total: number; current: number; label: string }) {
  return (
    <div className="flex justify-center gap-1.5" role="img" aria-label={label}>
      {Array.from({ length: total }, (_, index) => (
        <span
          key={index}
          className={`h-2 rounded-full ${index === current ? "w-6 bg-ink-strong" : "w-2 bg-line-strong"}`}
        />
      ))}
    </div>
  );
}

/** Six digits, one field: the phone's own one-time-code autofill fills it. */
export function CodeField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label htmlFor={id} className={LABEL}>
      {label}
      <input
        id={id}
        className={`${FIELD} text-center font-mono text-2xl tracking-[0.5em]`}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={6}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
      />
    </label>
  );
}

export type Address = { line1: string; postcode: string; city: string; country: string };
export const EMPTY: Address = { line1: "", postcode: "", city: "", country: "" };

/** B2452: street suggestions and a flag-and-name country picker, the same
 * `AddressLookupField`/`CountryField` pair `ContactManage` already runs —
 * wired in here once so both `/j` and `/w` get it. `enabled={false}` (the
 * capability off) leaves the street field the plain input it always was;
 * `CountryField` runs unconditionally, same as on `/me`. */
export function AddressFields({
  value,
  onChange,
  labels,
  enabled,
  username,
  locale,
  locales,
}: {
  value: Address;
  onChange: (next: Address) => void;
  labels: {
    street: string;
    postcode: string;
    city: string;
    country: string;
    countrySearchPlaceholder: string;
    countryNoMatches: string;
    addressLookupAttribution: string;
    addressLookupUnavailable: string;
  };
  /** `isEnabled("addressLookup", owner)`, from the page. */
  enabled: boolean;
  /** The journal's own username — `AddressLookupField`'s lookup is always
   * against the owner's journal, never the person filling this in. */
  username: string;
  /** The form's own locale. */
  locale: string;
  /** The journal's own languages — `CountryField` resolves a legacy stored
   * country string against these plus English. */
  locales: string[];
}) {
  const set = (key: keyof Address) => (e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...value, [key]: e.target.value });
  return (
    <div className="flex flex-col gap-3 rounded-2xl border-2 border-yellow-400 bg-yellow-50 p-4">
      <div>
        <label className={LABEL} htmlFor="guide-address-line1">
          {labels.street}
        </label>
        <AddressLookupField
          id="guide-address-line1"
          className={FIELD}
          value={value.line1}
          onChange={(line1) => onChange({ ...value, line1 })}
          onPick={(suggestion) =>
            onChange({ ...value, line1: suggestion.line1, postcode: suggestion.postcode, city: suggestion.city, country: suggestion.country })
          }
          enabled={enabled}
          username={username}
          locale={locale}
          label={labels.street}
          attribution={labels.addressLookupAttribution}
          unavailable={labels.addressLookupUnavailable}
          autoComplete="street-address"
        />
      </div>
      <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3">
        <label className={LABEL}>
          {labels.postcode}
          <input className={FIELD} autoComplete="postal-code" value={value.postcode} onChange={set("postcode")} />
        </label>
        <label className={LABEL}>
          {labels.city}
          <input className={FIELD} autoComplete="address-level2" value={value.city} onChange={set("city")} />
        </label>
      </div>
      <div>
        <label className={LABEL} htmlFor="guide-address-country">
          {labels.country}
        </label>
        <CountryField
          id="guide-address-country"
          value={value.country}
          locales={locales}
          onChange={(country) => onChange({ ...value, country })}
          label={labels.country}
          searchPlaceholder={labels.countrySearchPlaceholder}
          noMatches={labels.countryNoMatches}
          locale={locale}
        />
      </div>
    </div>
  );
}

export type Tick = {
  key: string;
  label: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  /** B2453/B2454: a small "recommended" pill beside the label — email, the
   * free channel, carries one on the notify step and the reach step's tabs. */
  badge?: string;
  /** B2505: a small drawing before the label, as the incentive on a channel. */
  icon?: ReactNode;
};

/** One tick per channel this server offers; a channel whose address is
 * missing is shown disabled, with the reason as its hint. */
export function Ticks({ ticks, onChange }: { ticks: Tick[]; onChange: (key: string, checked: boolean) => void }) {
  return (
    <div className="flex flex-col gap-2">
      {ticks.map((tick) => (
        <label
          key={tick.key}
          className={`flex min-h-12 items-center gap-3 rounded-2xl border border-line-quiet bg-surface-raised px-4 py-3 ${
            tick.disabled ? "opacity-60" : "cursor-pointer"
          }`}
        >
          <input
            type="checkbox"
            className="size-5 shrink-0 accent-navy-900"
            checked={tick.checked && !tick.disabled}
            disabled={tick.disabled}
            onChange={(e) => onChange(tick.key, e.target.checked)}
          />
          <span>
            <span className="flex flex-wrap items-center gap-2 font-semibold text-ink-strong">
              {tick.icon}
              {tick.label}
              {tick.badge && (
                <span className="rounded-full bg-yellow-400 px-2 py-0.5 text-xs font-bold text-yellow-950">{tick.badge}</span>
              )}
            </span>
            <span className="block text-sm text-ink-secondary">{tick.hint}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

export function Alert({ text }: { text: string | null }) {
  return text ? (
    <p role="alert" className="text-sm text-coral-600">
      {text}
    </p>
  ) : null;
}

/*
 * Illustrations in the brand palette (B2293), drawn in theme tokens so they
 * sit on the dark theme too. None of them is the waymark: the mark is never
 * redrawn (apply-the-brand), and these have no lozenge in them.
 */

export function WelcomeArt() {
  return (
    <svg viewBox="0 0 342 220" className="h-auto w-full" aria-hidden>
      <rect width="342" height="220" rx="22" className="fill-surface-subtle" />
      <path d="M-10 190 C60 160 90 180 140 150 S240 100 360 60" fill="none" className="stroke-surface-base" strokeWidth="14" strokeLinecap="round" />
      <path d="M-10 190 C60 160 90 180 140 150 S240 100 360 60" fill="none" className="stroke-ink-strong" strokeWidth="2" strokeDasharray="2 9" strokeLinecap="round" />
      <g transform="rotate(-6 155 91)">
        <rect x="70" y="26" width="170" height="130" rx="12" className="fill-surface-raised stroke-ink-strong" strokeWidth="2.5" />
        <path d="M84 122 l38-44 26 28 18-18 36 34z" className="fill-navy-600" />
        <circle cx="200" cy="56" r="11" className="fill-yellow-400" />
      </g>
    </svg>
  );
}

export function CodeArt() {
  return (
    <svg viewBox="0 0 342 140" className="h-auto w-full" data-testid="code-art-envelope" aria-hidden>
      <rect width="342" height="140" rx="22" className="fill-surface-subtle" />
      <rect x="96" y="22" width="150" height="100" rx="12" className="fill-surface-raised stroke-ink-strong" strokeWidth="2.5" />
      <path d="M96 34 l75 50 75-50" fill="none" className="stroke-ink-strong" strokeWidth="2.5" strokeLinejoin="round" />
      <circle cx="244" cy="28" r="18" className="fill-yellow-400 stroke-ink-strong" strokeWidth="2.5" />
      <path d="M236 28h16" className="stroke-navy-900" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/** The phone twin of `CodeArt`, for a code sent by SMS rather than email
 * (B2455) — same viewBox, stroke and badge conventions, a phone outline with
 * a message bubble instead of an envelope. */
export function PhoneArt() {
  return (
    <svg viewBox="0 0 342 140" className="h-auto w-full" data-testid="code-art-phone" aria-hidden>
      <rect width="342" height="140" rx="22" className="fill-surface-subtle" />
      <rect x="141" y="14" width="60" height="112" rx="12" className="fill-surface-raised stroke-ink-strong" strokeWidth="2.5" />
      <rect x="161" y="22" width="20" height="4" rx="2" className="fill-ink-strong" />
      <rect x="149" y="52" width="44" height="20" rx="7" className="stroke-ink-strong" strokeWidth="2.5" fill="none" />
      <circle cx="163" cy="62" r="2.5" className="fill-ink-strong" />
      <circle cx="171" cy="62" r="2.5" className="fill-ink-strong" />
      <circle cx="179" cy="62" r="2.5" className="fill-ink-strong" />
      <circle cx="244" cy="28" r="18" className="fill-yellow-400 stroke-ink-strong" strokeWidth="2.5" />
      <path d="M236 28h16" className="stroke-navy-900" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/** B2505: a stamped card, the size of a line of text — beside "WhatsApp ·
 * digital postcards" on the notify step. */
export function PostcardIcon() {
  return (
    <svg viewBox="0 0 24 18" className="h-4 w-5 shrink-0" aria-hidden data-testid="postcard-icon">
      <rect x="1" y="1" width="22" height="16" rx="2.5" className="fill-none stroke-current" strokeWidth="1.6" />
      <rect x="15.5" y="3.5" width="5" height="5.5" rx="0.8" className="fill-yellow-400" />
      <path d="M4 13.5l3.5-4 2.5 2.5 2-2 3 3.5" className="fill-none stroke-current" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

export function PostcardArt() {
  return (
    <svg viewBox="0 0 342 120" className="h-auto w-full" aria-hidden>
      <rect width="342" height="120" rx="22" className="fill-surface-subtle" />
      <g transform="rotate(-4 171 62)">
        <rect x="90" y="16" width="162" height="92" rx="6" className="fill-surface-raised stroke-ink-strong" strokeWidth="2.5" />
        <path d="M104 88 l30-32 18 18 14-12 28 26z" className="fill-navy-600" />
        <rect x="208" y="26" width="30" height="36" className="fill-yellow-400 stroke-ink-strong" strokeWidth="2" />
      </g>
      <path d="M270 34 q20 10 30 30" fill="none" className="stroke-ink-strong" strokeWidth="2" strokeDasharray="3 6" strokeLinecap="round" />
    </svg>
  );
}

export function WaitingArt() {
  return (
    <svg viewBox="0 0 342 160" className="h-auto w-full" aria-hidden>
      <rect width="342" height="160" rx="22" className="fill-surface-subtle" />
      <circle cx="171" cy="80" r="46" className="fill-surface-raised stroke-ink-strong" strokeWidth="2.5" />
      <path d="M171 52 v28 l18 12" fill="none" className="stroke-ink-strong" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="171" cy="80" r="4" className="fill-yellow-400" />
    </svg>
  );
}
