"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useI18n } from "./LocaleProvider";

/**
 * The way from a day into the room that can answer — B844, then B979.
 *
 * **The words changed in B994**, and the old ones are worth keeping in view:
 * *"Ask for anything else, in your own words"*. That is the sentence you
 * write for a blank text box — it asks somebody to compose, when what is on
 * the other end is an agent that could simply be told "this day, please". The
 * label says what the thing is now, and the composition exercise is gone.
 *
 * B844's problem is unchanged and is worth restating: a returning owner did
 * all six of her tasks from the day, the trip and the story, and reported
 * that there was no request box. There was one, three clicks away, on a page
 * an owner who has published a journal has no reason to open.
 *
 * What changed is what this draws. It used to open a text box in place, on
 * the day — a second, poorer copy of a conversation that already exists at
 * `/agent/<user>/chat`: no files, no preview of the day being changed, and
 * nothing of the thread surviving the page. Two places to say the same
 * sentence, one strictly worse, is exactly the drift B877 had just finished
 * cleaning up. So this is a link now, and it carries the day it was pressed
 * on — the room opens with *that* day in its preview rather than whatever was
 * last left unfinished.
 *
 * **It still asks the server whether it belongs here.** A 404 from
 * `GET /api/helper/<user>/ask` is "not your journal, or the helper is off",
 * and the honest answer to that is to draw nothing rather than a link to a
 * room that 404s. The call site is already inside an owner-only branch
 * (`canPublish`, which is exactly `isOwner`), so this is the second half of
 * the gate and not the first.
 */
export default function HelperAskHere({
  username,
  day,
}: {
  username: string;
  /** Absent on the trip overview, where there is no day to open the room on. */
  day?: { tripId: string; slug: string };
}) {
  const { t } = useI18n();
  const [offered, setOffered] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/helper/${encodeURIComponent(username)}/ask`)
      .then((response) => {
        if (!cancelled && response.ok) setOffered(true);
      })
      .catch(() => {
        // A journal that cannot answer shows nothing. The page is a travel
        // journal first, and this is an accelerator over controls that work.
      });
    return () => {
      cancelled = true;
    };
  }, [username]);

  if (!offered) return null;

  const context = day
    ? `?trip=${encodeURIComponent(day.tripId)}&slug=${encodeURIComponent(day.slug)}`
    : "";

  return (
    <Link
      href={`/agent/${encodeURIComponent(username)}/chat${context}`}
      className="inline-block min-h-11 text-xs font-semibold text-navy-700 underline underline-offset-4 transition-colors hover:text-navy-900"
    >
      {t("agent.askHereOpen")}
    </Link>
  );
}
