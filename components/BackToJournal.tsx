"use client";

import UpLink from "./UpLink";

/**
 * A way out, for the two pages that have no header.
 *
 * The trip gate and the invite form (`/{user}/i/<token>`) both render a
 * bare `<main>`, which was right — neither can show the trip navigation,
 * because on one of them you have not been let in and on the other you are not
 * a reader yet. But it left somebody who followed a link and then thought
 * better of it with nothing to do but edit the address bar or close the tab.
 * That reads as a dead end, which for the person most likely to meet the gate
 * — sent a link and a word, on a phone — is where they stop.
 *
 * It goes to the journal's trip list, not to `/{username}` — B1728. `/{user}`
 * is the *current trip's story*, and on a gate that is blocking exactly that
 * trip the old link put the reader back on the page they had just been
 * refused. The trip list shows what they may actually see.
 */
export default function BackToJournal({
  username,
  journalTitle,
}: {
  username: string;
  journalTitle: string;
}) {
  return (
    <UpLink
      href={`/${username}/trips`}
      label={journalTitle}
      className="inline-flex min-h-11 items-center gap-1.5 text-sm text-ink-secondary underline-offset-4
                 hover:text-ink-strong hover:underline focus-visible:outline-2
                 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
    />
  );
}
