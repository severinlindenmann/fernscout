"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import AgentRow from "./AgentRow";
import DayNotify from "./DayNotify";
import DeleteTrip from "./DeleteTrip";
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
 * **B1007 drew that last part the right way up.** The proportion above was
 * right and the drawing was not: the general form was the only thing in the
 * block with no surface to press, and on a draft day — where the grid is often
 * a single tile — the rule separated one tile from one underlined line, which
 * is to say it separated nothing. It is an `AgentRow` now, in full width under
 * the same rule, and on an unpublished day a second one sits above the tiles
 * in coral. Three sizes of thing, each with its own job: what is waiting to be
 * decided, the shortcuts, and the way in for everything else.
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
  tripId,
  onCorrect,
}: {
  username: string;
  /** Omitted on the trip overview, where the day-specific controls have no day. */
  day?: { tripId: string; slug: string; date: string; published: boolean };
  /** The trip overview's own id — what makes the delete control possible
   *  there, and only there (B1321). A day card never shows it: deleting the
   *  whole trip from inside one day is not a question anybody asked. */
  tripId?: string;
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

  /**
   * The helper's own remaining question, asked once for both rows — B1007.
   *
   * It used to live inside `HelperAskHere`, which was the only thing that
   * needed it. There are two rows now and the answer is the same for both, so
   * it is one call here rather than two identical ones a component apart.
   *
   * A 404 from `GET /api/helper/<user>/ask` is "not your journal, or the
   * helper is off", and the honest answer to that is to draw nothing rather
   * than a row into a room that 404s. The call site is already inside an
   * owner-only branch (`canPublish`), so this is the second half of the gate
   * and not the first.
   */
  const [helper, setHelper] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/helper/${encodeURIComponent(username)}/ask`)
      .then((response) => {
        if (!cancelled && response.ok) setHelper(true);
      })
      .catch(() => {
        // A journal that cannot answer shows nothing. The page is a travel
        // journal first, and this is an accelerator over controls that work.
      });
    return () => {
      cancelled = true;
    };
  }, [username]);

  /** The room, opened on the day it was pressed on rather than whatever was
      last left unfinished — B979. */
  // B984 — one URL, and the day rides as `about`. The room no longer lives at
  // a path carrying the journal's name.
  const room = `/agent${
    day ? `?about=${encodeURIComponent(`${day.tripId}/${day.slug}`)}` : ""
  }`;

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

      {/* The one decision that is waiting, and only while it is waiting. A
          published day draws nothing here, so the block gets quieter as the
          work finishes. The label is the request, not the state: the banner
          above already says it is a draft, and a control says what it does. */}
      {helper && day && !day.published && (
        <div className="mt-2.5">
          <AgentRow
            href={room}
            tone="coral"
            title={t("agent.publishRow")}
            hint={t("agent.publishRowHint")}
          />
        </div>
      )}

      <div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {day && (
          <DayNotify username={username} tripId={day.tripId} slug={day.slug} />
        )}
        <InviteToRead username={username} />
        {/* B816 — the way back into a day that is already on the site. Only on
            a published one: a draft has its own banner above and is in the
            resume list. It opens the wizard on the day's lead update, which is
            the one the page is named for.

            **Both branches say "Correct or take down" again, as of B980 round
            3.** B1013 split the label because `EditDay` could edit and could
            not unpublish; round 3 gave it its own `.../unpublish` door and its
            own `ConfirmPanel`, so the promise the tile makes is true on both
            branches once more — see `EditDay`'s own doc comment. */}
        {day?.published &&
          (onCorrect ? (
            <button type="button" onClick={onCorrect} className={OWNER_TOOL}>
              {t("agent.correctDay")}
            </button>
          ) : (
            <Link
              href={`/agent?about=${encodeURIComponent(`${day.tripId}/${day.slug}`)}`}
              prefetch={false}
              className={OWNER_TOOL}
            >
              {t("agent.correctDay")}
            </Link>
          ))}
      </div>

      {/* The rule is the point: above it are the things with their own button,
          below it is the same intent said in words. B844's box, moved by B877,
          and drawn as a row rather than an underlined line by B1007. */}
      {helper && (
        <div className="mt-3 border-t border-navy-200 pt-3">
          <AgentRow
            href={room}
            tone="yellow"
            // Named for the day when there is one — B994: "in your own
            // words" set a composition exercise in front of a link whose
            // other end already knows the day.
            title={t(day ? "agent.askHereOpenDay" : "agent.askHereOpen")}
            hint={t("agent.askHereHint")}
          />
        </div>
      )}

      {/* The one destructive act, last and quiet — B1321. A text link, not a
          tile: it must be findable without ever being the thing a thumb lands
          on. The confirmation names what goes with it. */}
      {!day && tripId && <DeleteTrip username={username} tripId={tripId} />}
    </section>
  );
}
