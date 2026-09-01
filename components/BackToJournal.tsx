"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useI18n } from "@/components/LocaleProvider";

/**
 * A way back, for the two pages that have no header.
 *
 * The trip gate and the invite form (`/{user}/i/<token>`) both render a
 * bare `<main>`, which was right — neither can show the trip navigation,
 * because on one of them you have not been let in and on the other you are not
 * a reader yet. But it left somebody
 * who followed a link and then thought better of it with nothing to do but
 * edit the address bar or close the tab. That reads as a dead end, which for
 * the person most likely to meet the gate — sent a link and a word, on a phone
 * — is where they stop.
 *
 * One link, to the journal these pages belong to. Not a header.
 */
export default function BackToJournal({
  username,
  journalTitle,
}: {
  username: string;
  journalTitle: string;
}) {
  const { t } = useI18n();
  return (
    <Link
      href={`/${username}`}
      className="inline-flex items-center gap-1.5 text-sm text-navy-600 underline-offset-4
                 hover:text-navy-900 hover:underline focus-visible:outline-2
                 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden />
      {t("nav.toJournal", { title: journalTitle })}
    </Link>
  );
}
