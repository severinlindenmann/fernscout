"use client";

import Link from "next/link";
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
 *
 * Both call sites render *this*, which is the actual remedy for what caused
 * the mess: there is now one place for a fifth control to land.
 *
 * **B1007 drew that last part the right way up.** The proportion above was
 * right and the drawing was not: the general form was the only thing in the
 * block with no surface to press, and on a draft day — where the grid is often
 * a single tile — the rule separated one tile from one underlined line, which
 * is to say it separated nothing. It was an `AgentRow`, in full width under
 * its own rule, and on an unpublished day a second one still sits above the
 * tiles in coral for the one decision that is actually waiting: publish.
 *
 * **B2309 dropped the yellow row and the studio hub it pointed at.** The
 * owner's own read: a grid that ends in "ask your agent" is a grid that did
 * not trust its own tiles. The helper probe that only existed to gate that
 * row's rendering went with it — nothing else called it. The block is the
 * few things an owner actually came to do, named, not a lobby in front of a
 * bigger room:
 *
 * - Trip page — invite, and the trip's own door into the studio, as peers.
 * - Day page — tell the readers, edit in place, delete. No invite here; a
 *   day is not who reads the journal, the trip is. Edit and Delete are now
 *   tiles too, and Edit shows on a draft the same as a published day.
 *
 * The gate is the caller's — `trip?.canPublish`, which is exactly `isOwner`
 * (`lib/tripGate.ts`). Each control asks the server its own remaining
 * question and draws nothing when the answer is no, so a journal with contacts
 * switched off shows fewer tiles rather than tiles that explain themselves
 * after being pressed.
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

        {/* The trip page's own two — invite, and the door into the studio for
            everything else about the trip (title, dates, who may read it, its
            own address, deletion — B2018). Peers, side by side, as the owner
            asked for them — B2309. */}
        {!day && <InviteToRead username={username} />}
        {!day && tripId && (
          <Link
            href={`/${encodeURIComponent(username)}/studio/trip?trip=${encodeURIComponent(tripId)}`}
            prefetch={false}
            className={OWNER_TOOL}
          >
            {t("owner.editTripInStudio")}
          </Link>
        )}

        {/* B816 — the way back into a day that is already on the site, now
            drawn on a draft too — B2309: there is no reason to correct a
            mistake only after it is published. It opens the wizard on the
            day's lead update, which is the one the page is named for.

            **Both branches say "Edit" — B2309 dropped "or take down": the
            block's own Delete tile below says that now, so the label no
            longer has to.** `EditDay` still offers its own take-down door in
            place for a published day (see its own doc comment); nothing that
            was reachable stopped being reachable. */}
        {day &&
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

        {/* B2259, drawn as a tile since B2309 — a peer of Edit rather than a
            text link under a rule, so the grid stops narrowing to "one real
            control and an afterthought" the further down it goes. */}
        {deletable && <DeleteDay username={username} day={deletable} tile />}
      </div>
    </section>
  );
}
