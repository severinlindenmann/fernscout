"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import AgentRow from "./AgentRow";
import DeleteDay, { type DeletableDay } from "./DeleteDay";
import DayNotify from "./DayNotify";
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
  deletable,
}: {
  username: string;
  /** Omitted on the trip overview, where the day-specific controls have no day. */
  day?: { tripId: string; slug: string; date: string; published: boolean };
  /** The trip overview's own id — what makes the studio link possible there,
   *  and only there. A day card never shows it: editing the whole trip from
   *  inside one day is not a question anybody asked. */
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
  /** B2259 — the day's lead entry, for "Delete…" at the foot of the block.
   *  Only a day card passes it. */
  deletable?: DeletableDay;
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

  // B2169 — the studio's publish page (B2140), with this day chosen. It was
  // the room at `/agent?about=` (B979/B984) while publishing had no flow of
  // its own; the studio page asks the same consent in words, on the site.
  const publish = day
    ? `/${encodeURIComponent(username)}/studio/day/publish?day=${encodeURIComponent(day.slug)}&trip=${encodeURIComponent(day.tripId)}`
    : `/${encodeURIComponent(username)}/studio/day/publish`;

  return (
    <section
      aria-label={t("owner.onlyYou")}
      className="mt-8 rounded-xl border border-line-quiet bg-surface-subtle p-3"
    >
      <p className="font-display text-sm font-semibold text-ink-strong">
        {t("owner.onlyYou")}
      </p>
      <p className="mt-0.5 text-xs leading-5 text-ink-secondary">
        {t("owner.onlyYouBody")}
      </p>

      {/* The one decision that is waiting, and only while it is waiting. A
          published day draws nothing here, so the block gets quieter as the
          work finishes. The label is the request, not the state: the banner
          above already says it is a draft, and a control says what it does. */}
      {day && !day.published && (
        <div className="mt-2.5">
          <AgentRow
            href={publish}
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
            // D4 (spec §6, B1831) — the day page's own edit tile deep-links
            // into "Change a day" with the day already chosen, rather than
            // into `/agent`: one implementation (`EditDay`, reused by both
            // doors), the studio flow being the door that does not already
            // have the panel open in place the way `onCorrect` above does.
            <Link
              href={`/${encodeURIComponent(username)}/studio/day/edit?slug=${encodeURIComponent(day.slug)}`}
              prefetch={false}
              className={OWNER_TOOL}
            >
              {t("agent.correctDay")}
            </Link>
          ))}
      </div>

      {/* The rule is the point: above it are the things with their own button,
          below it is the same intent said in words. B844's box, moved by
          B877, drawn as a row rather than an underlined line by B1007, and
          repointed at the studio hub by B1905.

          **This one now goes to `/<user>/studio`, not `/agent`.** It was
          "everything else, ask your agent" when the only door past the
          tiles above was a chat; the studio is a list of twelve flows now,
          so "everything else" is a page rather than a room. The copy lost
          its day-conditional wording along with the destination: the hub is
          not day-scoped the way the room's `?about=` used to be, and a
          title that still said "about this day" would be a promise this
          link no longer keeps. `/agent` itself is gone since B2173. */}
      {helper && (
        <div className="mt-3 border-t border-line-quiet pt-3">
          <AgentRow
            href={`/${encodeURIComponent(username)}/studio`}
            tone="yellow"
            title={t("agent.askHereOpen")}
            hint={t("agent.askHereHint")}
          />
        </div>
      )}

      {/* The door to everything else about this trip — title, dates, who may
          read it, its own address, and deletion — B2018. The trip page's own
          delete link moved there with the rest (B1412, superseded by
          B2018): the owner's own read of a trip is also the page they open
          to *read* it, and the one irreversible act no longer sits at the
          bottom of it every time. A text link, last and quiet, the same
          weight the old delete link had in this slot. */}
      {deletable && (
        <div className="mt-3 border-t border-line-quiet pt-1">
          <DeleteDay username={username} day={deletable} />
        </div>
      )}

      {!day && tripId && (
        <div className="mt-3 border-t border-line-quiet pt-3">
          <Link
            href={`/${encodeURIComponent(username)}/studio/trip?trip=${encodeURIComponent(tripId)}`}
            prefetch={false}
            className="text-xs font-semibold text-ink-body underline underline-offset-2 hover:opacity-75"
          >
            {t("owner.editTripInStudio")}
          </Link>
        </div>
      )}
    </section>
  );
}
