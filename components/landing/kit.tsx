import type { ReactNode } from "react";
import Link from "@/components/LanguageLink";
import { KICKER } from "./styles";

/**
 * The design kit every page outside the journal is built from — B2531, the
 * R3-Kit board. `PageShell` (the frame), `Band` (a section's ground and
 * width), `PageTitle` (the one h1) and the buttons in `./styles`. A journal
 * and its studio (`/@user/…`) keep their own frame: they are the owner's
 * page, not the site's.
 *
 * Two widths only. Wide is 1152px of content (the homepage's); reading is
 * 720px, for text and forms. The phone gutter is 16px in both.
 */
export const WIDE = "mx-auto w-full max-w-7xl px-4 sm:px-8 lg:px-16";
export const READING = "mx-auto w-full max-w-[49rem] px-4 sm:px-8";

/** Cream is the page, white the alternate band, sand the prices, navy one
 * feature band per page at most. */
const TONES = {
  cream: "bg-surface-base",
  white: "bg-surface-raised",
  sand: "bg-surface-subtle",
  navy: "bg-navy-900 text-navy-100",
} as const;

export type BandTone = keyof typeof TONES;

/** One band of a page: the same padding everywhere, 88px desktop, 48px phone. */
export function Band({
  tone = "cream",
  width = "wide",
  id,
  className = "",
  children,
}: {
  tone?: BandTone;
  width?: "wide" | "reading";
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className={`${TONES[tone]} scroll-mt-4 py-12 lg:py-22`}>
      <div className={`${width === "wide" ? WIDE : READING} ${className}`}>{children}</div>
    </section>
  );
}

/** The hero size, only on a selling page's first screen. */
export const HERO_H1 =
  "text-balance font-display text-[clamp(2.4rem,7vw,4.25rem)] font-semibold leading-[1.06] text-ink-strong";
/** Every other page's h1: 40px, 32px on a phone. */
export const TITLE_H1 =
  "text-balance font-display text-[clamp(2rem,6vw,2.5rem)] font-semibold leading-[1.1] text-ink-strong";

/** A section's heading, 30–44px. */
export const SECTION_H2 =
  "text-balance font-display text-[clamp(1.875rem,4.5vw,2.75rem)] font-semibold leading-[1.08] text-ink-strong";

export function PageTitle({
  hero = false,
  kicker,
  lede,
  children,
}: {
  hero?: boolean;
  kicker?: ReactNode;
  lede?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 lg:gap-4">
      {kicker && <p className={KICKER}>{kicker}</p>}
      <h1 className={hero ? HERO_H1 : TITLE_H1}>{children}</h1>
      {lede && <p className="max-w-[60ch] text-lg leading-relaxed text-ink-body">{lede}</p>}
    </div>
  );
}

/** The mark and the site's name, home. */
export function Logo({ siteName }: { siteName: string }) {
  return (
    <Link
      href="/"
      className="flex items-center gap-2.5 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icon.svg" alt="" width={38} height={38} className="h-9 w-9" />
      <span className="font-display text-2xl font-semibold text-ink-strong">{siteName}</span>
    </Link>
  );
}
