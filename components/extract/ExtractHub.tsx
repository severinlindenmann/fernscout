"use client";

import Link from "next/link";
import { ArrowLeft, Images, MapPin, Users, Wallet } from "lucide-react";
import { useI18n } from "@/components/LocaleProvider";

/**
 * "What do you want to bring in?" — the import's front door, B1797.
 *
 * The visual draft (`.superpowers/sdd/b1797/design-v2.html`) never drew this
 * screen — it assumed photographs were the whole feature — so this composes
 * in the same register rather than copying one: a card per choice, each with
 * a title and one sentence of consequence, the pattern Step 02 uses for "new
 * trip or existing" and "talk or type".
 *
 * Photographs open the guided flow B1751 already built. The other three are
 * a plain upload each — pick a file, it goes through the importer that
 * already exists, you see what it read — and each names the file it wants
 * and points at `/docs/extract` rather than repeating that guide here.
 */
export default function ExtractHub({ username }: { username: string }) {
  const { t } = useI18n();
  const journalHref = `/${username}`;

  const choices = [
    {
      href: `/${username}/extract/photos`,
      Icon: Images,
      title: t("extract.hub.photos"),
      description: t("extract.hub.photosDescription"),
    },
    {
      href: `/${username}/extract/location`,
      Icon: MapPin,
      title: t("extract.hub.location"),
      description: t("extract.hub.locationDescription"),
    },
    {
      href: `/${username}/extract/contacts`,
      Icon: Users,
      title: t("extract.hub.contacts"),
      description: t("extract.hub.contactsDescription"),
    },
    {
      href: `/${username}/extract/costs`,
      Icon: Wallet,
      title: t("extract.hub.costs"),
      description: t("extract.hub.costsDescription"),
    },
  ];

  return (
    <div className="mx-auto max-w-xl px-4 py-8">
      <Link
        href={journalHref}
        className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-ink-body transition-colors hover:text-ink-strong"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden strokeWidth={2.4} />
        {t("extract.backToJournal")}
      </Link>

      <h1 className="mt-4 font-display text-2xl font-semibold text-ink-strong">{t("extract.hub.title")}</h1>
      <p className="mt-1 text-sm text-ink-secondary">{t("extract.hub.subtitle")}</p>

      <ul className="mt-5 flex flex-col gap-3">
        {choices.map(({ href, Icon, title, description }) => (
          <li key={href}>
            <Link
              href={href}
              className="flex items-start gap-3 rounded-xl border border-line-strong bg-surface-raised px-4 py-3 transition-colors hover:bg-surface-subtle"
            >
              <Icon className="mt-0.5 h-5 w-5 flex-none text-ink-secondary" aria-hidden strokeWidth={2} />
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-semibold text-ink-strong">{title}</span>
                <span className="text-xs text-ink-secondary">{description}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <p className="mt-5 text-xs text-ink-secondary">
        {t("extract.hub.guideHint")}{" "}
        <Link href="/docs/extract" className="font-semibold underline">
          {t("extract.hub.guideLink")}
        </Link>
      </p>
    </div>
  );
}
