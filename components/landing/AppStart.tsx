"use client";

import type { ReactNode } from "react";
import Link from "@/components/LanguageLink";
import { ChevronLeft } from "lucide-react";
import { useI18n } from "@/components/LocaleProvider";
import { posterSrc } from "@/components/mediaLoader";
import type { DemoDay } from "@/lib/demoDay";
import { useDoors, type InviteCta } from "./Frame";
import { Logo } from "./kit";
import { PILL_GHOST, PILL_PRIMARY, TEXT_LINK } from "./styles";

/**
 * The signed-out `/` inside the iPhone app — B-3012.
 *
 * Somebody who installed the app has already decided to try it, so the
 * website's pitch (prices, schools, operators, questions, agents) stays on
 * the website. One screen: the demo day's photo, the headline, the one
 * primary door `useDoors` would give the website, the way in for everybody
 * who already has a journal or was let into one, and the demo.
 *
 * `signIn`, when set, is the `IdentitySignIn` that `Landing` owns, shown
 * full screen in place of the start with a way back.
 *
 * The foot is navy because `ServerChoice` is drawn in the website footer's
 * colours.
 */
export default function AppStart({
  siteName,
  demo,
  inviteCta,
  photobook,
  legal,
  onSignIn,
  signIn,
  onBack,
  serverChoice,
}: {
  siteName: string;
  demo?: DemoDay | null;
  inviteCta: InviteCta;
  photobook: boolean;
  legal?: boolean;
  onSignIn: () => void;
  signIn?: ReactNode;
  onBack: () => void;
  serverChoice?: ReactNode;
}) {
  const { t } = useI18n();
  const { cta } = useDoors({ inviteCta, helperEnabled: false, prints: false, pricing: false });

  if (signIn) {
    return (
      <div className="flex min-h-dvh flex-col bg-surface-base text-ink-body">
        <div aria-hidden className="h-1.5 bg-tint" />
        <div className="px-4 pt-3">
          <button
            type="button"
            onClick={onBack}
            aria-label={t("landing.navHome")}
            className="grid size-11 place-items-center rounded-full border border-line-quiet text-ink-strong
                       focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
          >
            <ChevronLeft aria-hidden className="size-6" />
          </button>
        </div>
        <main id="main" className="mx-auto w-full max-w-md flex-1 px-4 py-4">
          {signIn}
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col bg-surface-base text-ink-body">
      <div aria-hidden className="h-1.5 bg-tint" />
      <main id="main" className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-4 pb-6 pt-4">
        <Logo siteName={siteName} />
        {demo && (
          <Link
            href={demo.href}
            className="relative block overflow-hidden rounded-[22px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={posterSrc(demo.photo.src, 1024)}
              alt={demo.photo.alt}
              className="block h-44 w-full object-cover"
            />
            <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-navy-900/70 to-transparent px-4 pb-3 pt-8 text-sm font-semibold text-cream-50">
              {demo.title}
            </span>
          </Link>
        )}
        <h1 className="font-display text-[2rem] font-semibold leading-[1.08] text-ink-strong text-balance">
          {t("landing.hero")}
        </h1>
        <p className="text-base leading-relaxed">{t(photobook ? "landing.ledeBookApp" : "landing.ledeApp")}</p>
        <div className="mt-auto flex flex-col gap-3 pt-2">
          {cta && (
            <Link href={cta.href} className={PILL_PRIMARY}>
              {cta.label}
            </Link>
          )}
          <button type="button" onClick={onSignIn} className={cta ? PILL_GHOST : PILL_PRIMARY}>
            {t("landing.signIn")}
          </button>
          <p className="text-center text-sm text-ink-secondary">{t("landing.app.signInNote")}</p>
          {cta?.href === "/invite" && (
            <Link href="/welcome" className={`self-center text-[15px] ${TEXT_LINK}`}>
              {t("inviteRequest.alreadyInvited")}
            </Link>
          )}
          {demo && (
            <Link href={demo.journalHref} className={`self-center text-[15px] ${TEXT_LINK}`}>
              {t("landing.demoLink")}
            </Link>
          )}
        </div>
      </main>
      {(legal || serverChoice) && (
        <footer className="flex flex-col items-center gap-2 bg-navy-900 px-4 py-4 text-navy-300 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
          {legal && (
            <Link href="/legal" className="text-[15px] text-cream-50 hover:underline">
              {t("landing.legal")}
            </Link>
          )}
          {serverChoice && <div className="w-full max-w-md text-center">{serverChoice}</div>}
        </footer>
      )}
    </div>
  );
}
