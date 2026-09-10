"use client";

import { useI18n } from "@/components/LocaleProvider";
import type { Opening, OpeningDay } from "@/lib/helper/opening";

/**
 * What the room says before anybody has said anything — B984.
 *
 * The page this replaced put four calls to action on one card, two of them the
 * same yellow, and an owner said they felt overwhelmed. The fix is not three
 * instead of four: it is that a page should not ask somebody to choose before
 * they have said anything. So this is one sentence about what is actually
 * there, and an offer that follows from it.
 *
 * ## Everything here is a shortcut for typing
 *
 * A chip does not do anything. It sends a sentence — *"Schreib den Tag vom 30.
 * April fertig"* — through the ordinary ask, and the ordinary machinery
 * proposes what it always would. That is why this needs no new tool, no new
 * route and no new block shape: the offer is a set of prepared sentences, and
 * the field underneath is what they are a shortcut for.
 *
 * ## One bright thing — B1021 corrected what that means
 *
 * `test/agent-door-calm.test.tsx` counted the yellow things on the card this
 * replaces and failed on more than one. That test went with the card, and
 * B767's finding did not: a screen has exactly one bright thing and it is
 * what the person came to do.
 *
 * The literal rule — one `bg-yellow-400` anywhere on the screen — is false in
 * the commonest state: `StoryPager.tsx` draws the page's current position as
 * a dot in the same yellow, and the preview pane has one loaded by default in
 * `days`. The dot is `aria-hidden` and pressable by nobody, so the rule that
 * survives is the one that was actually meant: **one bright thing that can be
 * pressed.** `test/room-opening.test.tsx` renders every state of this
 * component alone and counts its own `bg-yellow-400` **buttons** — never
 * every element of that colour on the page, which a decorative dot elsewhere
 * would trip for no reason a person pressing something would recognise.
 */
export default function RoomOpening({
  opening,
  onSay,
  whatsappNumber,
}: {
  opening: Opening;
  /** Sends a sentence as though it had been typed. */
  onSay: (said: string) => void;
  /**
   * The number for a `wa.me` chip, resolved on the server — B1127. Both
   * gating facts (a proven number, `whatsappInbound` on for this journal)
   * are already checked by the time this prop exists at all; the component
   * only ever asks "is there one to draw".
   */
  whatsappNumber?: string;
}) {
  const { t, tn, formatLongDate } = useI18n();

  const chip =
    "min-h-11 rounded-full border border-navy-300 bg-white px-4 text-sm text-navy-800 transition-colors hover:bg-navy-50";
  const bright =
    "min-h-11 rounded-full border border-yellow-600 bg-yellow-400 px-4 text-sm font-semibold text-yellow-950 transition-colors hover:bg-yellow-300";

  /** A day, with what it is still missing said on the thing you press — so the
   *  status is the action rather than a second box reporting it. */
  function Day({ day, first }: { day: OpeningDay; first: boolean }) {
    const missing = [
      day.photos > 0
        ? tn("agent.open.photos", day.photos, { count: String(day.photos) })
        : t("agent.open.noPhotos"),
      ...(day.written ? [] : [t("agent.open.noWords")]),
    ].join(" · ");
    /**
     * `formatLongDate`, never `toLocaleDateString(undefined, …)` — B1169.
     * The server renders this component too, in its own locale; the browser
     * re-renders it in the reader's. The two disagreed ("Friday 30 April"
     * vs "Friday, April 30"), React threw a hydration mismatch, and the
     * whole page regenerated client-side with a visible jump on every
     * arrival. `HelperConsentList.tsx` documents the same trap.
     */
    const when = formatLongDate(day.date);
    return (
      <div className="rounded-xl border border-navy-200 bg-white p-4 shadow-sm">
        <p className="font-display text-base font-semibold text-navy-900">{when}</p>
        <p className="mt-0.5 text-sm text-navy-500">{missing}</p>
        <button
          type="button"
          onClick={() => onSay(t("agent.open.sayFinish", { date: when }))}
          className={`mt-3 ${first ? bright : chip}`}
        >
          {t("agent.open.finishIt")}
        </button>
      </div>
    );
  }

  const said = (key: Parameters<typeof t>[0], vars?: Record<string, string>) => () =>
    onSay(t(key, vars));

  return (
    <div className="space-y-3">
      <p className="rounded-xl border border-navy-200 bg-white px-4 py-3 shadow-sm text-base leading-6 text-navy-800">
        {opening.state === "days" &&
          (opening.days.length + opening.more === 1
            ? t("agent.open.oneDay")
            : tn("agent.open.days", opening.days.length + opening.more, {
                count: String(opening.days.length + opening.more),
              }))}
        {opening.state === "clear" &&
          // The same B1169 rule as `Day` above: a fixed-locale format the
          // server and the browser agree on.
          t("agent.open.clear", { date: formatLongDate(opening.lastDate) })}
        {opening.state === "finished" &&
          t("agent.open.finished", { title: opening.title, count: String(opening.days) })}
        {opening.state === "fresh" && t("agent.open.fresh", { title: opening.title })}
        {opening.state === "empty" && t("agent.open.empty")}
      </p>

      {/* Trip progress — B1218 (D45). Present on any state, since a running
          trip's untold days matter whatever else the opening is about. */}
      {opening.progress && (
        <div className="space-y-2">
          <p className="text-sm text-navy-600">
            {t("agent.open.progressDay", {
              day: String(opening.progress.day),
              total: String(opening.progress.total),
            })}
            {" — "}
            {tn("agent.open.progressMissing", opening.progress.missing.length, {
              count: String(opening.progress.missing.length),
            })}
          </p>
          <div className="flex flex-wrap gap-2">
            {opening.progress.missing.slice(0, 5).map((date) => (
              <button
                key={date}
                type="button"
                onClick={() => onSay(t("agent.open.sayAbout", { date: formatLongDate(date) }))}
                className={chip}
              >
                {formatLongDate(date)}
              </button>
            ))}
            {opening.progress.missing.length > 5 && (
              <span className="self-center text-sm text-navy-500">
                {tn("agent.open.more", opening.progress.missing.length - 5, {
                  count: String(opening.progress.missing.length - 5),
                })}
              </span>
            )}
          </div>
        </div>
      )}

      {opening.state === "days" && (
        <>
          {opening.days.map((day, n) => (
            <Day key={`${day.trip}/${day.slug}`} day={day} first={n === 0} />
          ))}
          {opening.more > 0 && (
            <p className="text-sm text-navy-500">
              {tn("agent.open.more", opening.more, { count: String(opening.more) })}
            </p>
          )}
        </>
      )}

      <div className="flex flex-wrap gap-2">
        {(opening.state === "clear" || opening.state === "fresh") && (
          <>
            <button type="button" onClick={said("agent.open.sayNewDay")} className={bright}>
              {t("agent.open.newDay")}
            </button>
            <button type="button" onClick={said("agent.open.sayPhotos")} className={chip}>
              {t("agent.open.catchPhotos")}
            </button>
          </>
        )}

        {/* Where a photobook and postcards stop being features to discover.
            The machinery for both has existed and been honest for months; what
            was missing is that nothing ever offered them. */}
        {opening.state === "finished" && (
          <>
            <button
              type="button"
              onClick={said("agent.open.sayBook", { title: opening.title })}
              className={bright}
            >
              {t("agent.open.photobook")}
            </button>
            <button
              type="button"
              onClick={said("agent.open.sayCards", { title: opening.title })}
              className={chip}
            >
              {t("agent.open.postcards")}
            </button>
            <button
              type="button"
              onClick={said("agent.open.sayInvite", { title: opening.title })}
              className={chip}
            >
              {t("agent.open.invite")}
            </button>
          </>
        )}

        {/* In every state, and the only control that is: starting a trip was
            offered by nothing at all before this. Bright only where it is the
            one thing to do. */}
        <button
          type="button"
          onClick={said("agent.open.sayNewTrip")}
          className={opening.state === "empty" ? bright : chip}
        >
          {t("agent.open.newTrip")}
        </button>

        {/* wa.me — B1127. Drawn whenever the server handed one over, which
            is only once it has already checked both gating facts (a proven
            number, `whatsappInbound` on for this journal); the component
            itself decides nothing. A link, not a chip that calls `onSay` —
            it leaves the room rather than sending a sentence through it. */}
        {whatsappNumber && (
          <a
            href={`https://wa.me/${whatsappNumber}?text=${encodeURIComponent(t("agent.open.whatsappGreeting"))}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center rounded-full border border-green-700 bg-green-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-green-500"
          >
            {t("agent.open.whatsapp")}
          </a>
        )}
      </div>
    </div>
  );
}
