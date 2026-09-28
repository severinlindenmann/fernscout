"use client";

import Link from "next/link";
import { useI18n } from "@/components/LocaleProvider";

/**
 * The door to `/me`, beside the theme and language switches.
 *
 * A word and a letter rather than a bare person icon: the readers this site
 * is written for are past sixty and on a phone, and an unlabelled silhouette
 * is a guess (B426 put the way in at the language switcher's weight, B427
 * found that too quiet). The letter is the first character of the address
 * this browser is signed in as — the one thing on the chip that says *whose*
 * account it is, on a shared tablet.
 *
 * Below `lg` the word goes to screen readers only (B2519): the signed-in
 * header's nav needs the room, and the Owner-Phone board draws the letter.
 *
 * Rendered only once the page knows somebody is signed in; the caller passes
 * the address from `/api/v2/me/home` and nothing else decides.
 */
export default function AccountChip({ email }: { email: string }) {
  const { t } = useI18n();
  const initial = email.trim().charAt(0).toUpperCase() || "?";
  return (
    <Link
      href="/me"
      className={`flex min-h-11 items-center gap-2 rounded-full border border-line-quiet bg-surface-raised py-1 pr-3.5 pl-1
                 max-lg:pr-1 text-xs font-bold text-ink-strong transition-colors hover:border-line-ink
                 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500`}
    >
      <span
        aria-hidden
        className="grid h-8 w-8 place-items-center rounded-full bg-yellow-300 font-display text-sm font-semibold text-on-bright"
      >
        {initial}
      </span>
      <span className="max-lg:sr-only">{t("meAccount.chip")}</span>
    </Link>
  );
}
