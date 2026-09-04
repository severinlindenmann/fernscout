"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import GuestSignIn from "@/components/GuestSignIn";
import BackToJournal from "@/components/BackToJournal";
import { useI18n } from "@/components/LocaleProvider";

/**
 * What a reader meets in front of a trip they may not read.
 *
 * This used to be a password box: one secret, held by everybody who was ever
 * sent it, forwarded without the owner knowing, revocable only by changing it
 * and thereby cutting off the whole family at once. It also asked the wrong
 * question of the person most likely to meet it — somebody in their seventies,
 * on a phone, who was sent a link a month ago and has certainly lost the word
 * that came with it. What they have not lost is their e-mail address.
 *
 * So the gate asks for that instead, and reuses the flow that was already
 * running on `/<user>/me`: an address, a six-digit code and a one-tap link in
 * the mail.
 *
 * **Signing in is not what opens the trip**, and that is the whole design.
 * `/api/auth/request` will mail a code to any address on earth — it has to,
 * because answering differently for a known address would turn this form into
 * a way of asking who reads somebody's journal. The session it produces is an
 * identity claim and nothing more; whether it opens this trip is decided
 * afterwards by `mayReadTrip`, from the trip's `people:` list and the owner's
 * grant. A stranger who signs in here sees exactly this page again.
 *
 * **It never names the trip.** See B117, and the `<h1>` below.
 *
 * Which is why there are four states and not one:
 *
 * - **not signed in** — the form, and an honest sentence about who it is for.
 * - **signed in, refused because this trip is `private`, and refused to an
 *   approved journal guest specifically** — B300. "Ask whoever writes this
 *   journal to let you in" is false for exactly this reader: they already
 *   asked, and were let in — into the journal, not this trip, and no request
 *   changes that. Told apart from the state below by `guestBlockedByPrivate`,
 *   which `lib/tripGate.ts`'s `guestBlockedByPrivateTrip` computes without
 *   ever handing this component the trip's visibility, its id or its title —
 *   only the one bit this sentence needs.
 * - **signed in, still refused, for any other reason** — anybody who signed in
 *   with the wrong address, or a stranger who is signed in but not a guest of
 *   this journal at all. Showing them the form again would have them sign in
 *   twice and conclude the site is broken.
 * - **sign-in switched off for this journal** — no form to show, so it says
 *   what to do instead rather than offering a door that leads nowhere.
 */
export default function TripGate({
  username,
  journalTitle,
  signedInAs,
  canSignIn,
  codeMinutes,
  guestBlockedByPrivate,
}: {
  username: string;
  journalTitle: string;
  /** The address on this journal's session cookie, or null for a stranger. */
  signedInAs: string | null;
  /** Whether codes can be issued at all — `features.auth` for this journal. */
  canSignIn: boolean;
  /** How long a code lasts, from `CODE_TTL_MINUTES` — see GuestSignIn. */
  codeMinutes: string;
  /**
   * True only when the viewer is an approved guest of this journal, refused
   * this one trip because it is `private` — never anything a viewer who is
   * *not* that reader could tell apart from an ordinary refusal. See
   * `guestBlockedByPrivateTrip` in `lib/tripGate.ts`, the only place this is
   * computed.
   */
  guestBlockedByPrivate: boolean;
}) {
  const { t } = useI18n();
  /**
   * The page the reader actually asked for, which is this one: both gate
   * layouts render in place of the requested route, so the URL is still
   * `/<user>/trips/<id>` or the day underneath it. Handing it to the form is
   * what makes the button in the mail come back here instead of dropping
   * somebody on a front page that does not mention the trip they clicked —
   * and a `guest` trip is never listed, so from the front page there is no
   * link back to it at all.
   *
   * Null only during the static render Next does of a `usePathname` boundary;
   * a missing destination is the old behaviour, not a broken one.
   */
  const here = usePathname();

  // `guestBlockedByPrivate` only ever means something when somebody is
  // signed in — a stranger with no session cannot be the approved guest it
  // describes — so the check is doubled here rather than trusted alone. Not
  // a security boundary (the caller already computed it from the session),
  // just the same defensive habit the rest of this component keeps: nothing
  // upstream is treated as enough on its own.
  const refusedForPrivacy = Boolean(signedInAs) && guestBlockedByPrivate;

  return (
    <main
      id="main"
      tabIndex={-1}
      className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-6 py-16"
    >
      {/* Never the trip's title — B117. The gate used to name the trip to a
          reader with no session at all, which made a private trip's title
          readable to anyone who guessed its id, while a reader who had signed
          in and been refused was told nothing. The journal's name is public,
          is what a reader needs in order to know whose sign-in form this is,
          and is already the tab's title on this page. */}
      <h1 className="font-display text-2xl text-navy-900">
        {signedInAs ? t(refusedForPrivacy ? "gate.privateTitle" : "gate.refusedTitle") : journalTitle}
      </h1>

      {signedInAs ? (
        <>
          <p className="mt-3 text-lg leading-8 text-navy-700">
            {refusedForPrivacy
              ? t("gate.privateBody")
              : t("gate.refusedBody", { email: signedInAs })}
          </p>
          {/* Not a dead end. `/<user>/me` is the page that lists what this
              address *can* open, and carries the control for signing out and
              trying another one. */}
          <Link
            href={`/${username}/me`}
            className="mt-5 text-base text-navy-900 underline underline-offset-4"
          >
            {t("gate.refusedSeeAccess")}
          </Link>
        </>
      ) : canSignIn ? (
        <>
          <p className="mt-3 text-lg leading-8 text-navy-700">{t("gate.signInBody")}</p>
          <GuestSignIn
            username={username}
            codeMinutes={codeMinutes}
            destination={here ?? undefined}
          />
        </>
      ) : (
        <p className="mt-3 text-lg leading-8 text-navy-700">{t("gate.askOwner")}</p>
      )}

      {/* This page has no header — it cannot show a locked trip's navigation —
          and without this there was nothing to do but edit the address bar. */}
      <div className="mt-10">
        <BackToJournal username={username} journalTitle={journalTitle} />
      </div>
    </main>
  );
}
