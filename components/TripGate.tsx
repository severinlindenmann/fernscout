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
 * Which is why there are three states and not one:
 *
 * - **not signed in** — the form, and an honest sentence about who it is for.
 * - **signed in, still refused** — a different sentence entirely. This is what
 *   a guest of the journal hits on a `private` trip, and what anybody who
 *   signed in with the wrong address hits. Showing them the form again would
 *   have them sign in twice and conclude the site is broken.
 * - **sign-in switched off for this journal** — no form to show, so it says
 *   what to do instead rather than offering a door that leads nowhere.
 */
export default function TripGate({
  tripTitle,
  username,
  journalTitle,
  signedInAs,
  canSignIn,
  codeMinutes,
}: {
  tripTitle: string;
  username: string;
  journalTitle: string;
  /** The address on this journal's session cookie, or null for a stranger. */
  signedInAs: string | null;
  /** Whether codes can be issued at all — `features.auth` for this journal. */
  canSignIn: boolean;
  /** How long a code lasts, from `CODE_TTL_MINUTES` — see GuestSignIn. */
  codeMinutes: string;
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

  return (
    <main
      id="main"
      tabIndex={-1}
      className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-6 py-16"
    >
      <h1 className="font-display text-2xl text-navy-900">
        {signedInAs ? t("gate.refusedTitle") : tripTitle}
      </h1>

      {signedInAs ? (
        <>
          <p className="mt-3 text-lg leading-8 text-navy-700">
            {t("gate.refusedBody", { email: signedInAs })}
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
