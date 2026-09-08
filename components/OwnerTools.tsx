"use client";

import Link from "next/link";
import DayNotify from "./DayNotify";
import HelperAskHere from "./HelperAskHere";
import InviteToRead from "./InviteToRead";
import { useI18n } from "./LocaleProvider";
import { OWNER_TOOL } from "./ownerToolClass";

/**
 * Everything the owner can do here, in one block that says it is theirs — B877.
 *
 * Before this there was no block: `StoryPager` and `TripStory` each grew one
 * control per ticket — B799 the invite, B816 the correction link, B844 the ask
 * box, on top of B633's notify button — in three different sessions, none of
 * which could see the others. Each was right on its own. Together they were
 * four controls in three visual weights, stacked under the reader's reactions
 * row with nothing between them and nothing saying who they were for. The
 * owner's word for it was "wild".
 *
 * Three things this fixes, and they are all arrangement rather than behaviour:
 *
 * - **It says whose it is.** "Only you can see this", and the line under it
 *   answers the question two testers asked and nobody had put on the page:
 *   what does my family actually see? The day above. None of this.
 * - **The controls are peers.** Telling readers, showing somebody, correcting
 *   or taking down: one weight, one shape, one grid — `OWNER_TOOL`. Two per
 *   row at 390px rather than a column of full-width buttons.
 * - **The ask box is the general form**, under a rule, rather than a fifth
 *   line in a fourth style. The tiles are its shortcuts, so it reads as the
 *   place to go when none of them fits.
 *
 * Both call sites render *this*, which is the actual remedy for what caused
 * the mess: there is now one place for a fifth control to land.
 *
 * The gate is the caller's — `trip?.canPublish`, which is exactly `isOwner`
 * (`lib/tripGate.ts`). Each control asks the server its own remaining
 * question and draws nothing when the answer is no, so a journal with contacts
 * switched off or a helper turned off shows fewer tiles rather than tiles that
 * explain themselves after being pressed.
 */
export default function OwnerTools({
  username,
  day,
  onCorrect,
}: {
  username: string;
  /** Omitted on the trip overview, where the day-specific controls have no day. */
  day?: { tripId: string; slug: string; date: string; published: boolean };
  /**
   * What the correction tile does where the day itself can be edited — B980.
   *
   * Given (the day card), it opens the panel on the page: the mistake is on
   * screen and the fix belongs beside it. Absent (the trip overview), the tile
   * is the link to the wizard it has been since B816, because there is no one
   * day there to correct.
   */
  onCorrect?: () => void;
}) {
  const { t } = useI18n();

  return (
    <section
      aria-label={t("owner.onlyYou")}
      className="mt-8 rounded-xl border border-navy-200 bg-cream-100 p-3"
    >
      <p className="font-display text-sm font-semibold text-navy-900">
        {t("owner.onlyYou")}
      </p>
      <p className="mt-0.5 text-xs leading-5 text-navy-600">
        {t("owner.onlyYouBody")}
      </p>

      <div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {day && (
          <DayNotify username={username} tripId={day.tripId} slug={day.slug} />
        )}
        <InviteToRead username={username} />
        {/* B816 — the way back into a day that is already on the site. Only on
            a published one: a draft has its own banner above and is in the
            resume list. It opens the wizard on the day's lead update, which is
            the one the page is named for. */}
        {day?.published &&
          (onCorrect ? (
            <button type="button" onClick={onCorrect} className={OWNER_TOOL}>
              {t("agent.correctDay")}
            </button>
          ) : (
            <Link
              href={`/agent?about=${encodeURIComponent(`${day.tripId}/${day.slug}`)}`}
              className={OWNER_TOOL}
            >
              {t("agent.correctDay")}
            </Link>
          ))}
      </div>

      {/* The rule is the point: above it are the things with their own button,
          below it is the same intent said in words. B844's box, moved rather
          than changed. */}
      <div className="mt-3 border-t border-navy-200 pt-2">
        <HelperAskHere
          username={username}
          day={day ? { tripId: day.tripId, slug: day.slug } : undefined}
        />
      </div>
    </section>
  );
}
