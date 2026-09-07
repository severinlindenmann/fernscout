"use client";

import { useI18n } from "@/components/LocaleProvider";
import BackLink from "./BackLink";

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
 * A way back, to wherever they came from if that was in-app, and to the
 * journal these pages belong to otherwise — B822. Not a header.
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
    <BackLink
      fallbackHref={`/${username}`}
      fallbackLabel={t("nav.toJournal", { title: journalTitle })}
      retraceLabel={t("nav.back")}
      className="inline-flex min-h-11 items-center gap-1.5 text-sm text-navy-600 underline-offset-4
                 hover:text-navy-900 hover:underline focus-visible:outline-2
                 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
    />
  );
}
