"use client";

import Link from "next/link";
import AgentHandover from "@/components/AgentHandover";
import GuestSignIn from "@/components/GuestSignIn";
import SignOut from "@/components/SignOut";
import PageHeader from "@/components/PageHeader";
import { useI18n } from "@/components/LocaleProvider";
import { useSite } from "@/components/SiteProvider";
import type { TranslationKey } from "@/lib/i18n";
import type { Viewer } from "@/lib/viewer";

/**
 * "What can I see?"
 *
 * Written for the reader least comfortable with software on the site — the
 * grandmother who opens it once a month from a link in an email and, when she
 * loses the email, has no way back in. So: large type, few controls, no
 * jargon, and every line answers a question she would actually ask.
 *
 * It is deliberately not an account page. There is no trip creation form and
 * no entry editing, because writing happens through an agent (ROADMAP decision
 * 24) — the panel's job is to tell you what to hand one, and to let you change
 * the one thing that is genuinely yours: your own name and address.
 */
export default function MePageContent({
  viewer,
  username,
  docUrl,
  manageHref,
  canSignIn,
  codeMinutes,
  contactsEnabled,
  ownerName,
  signinNotice,
}: {
  viewer: Viewer;
  username: string;
  docUrl: string;
  /** Present only when this reader has a contact record to edit. */
  manageHref?: string;
  /** Whether codes can be issued at all, which is what signing in needs. */
  canSignIn: boolean;
  /** How long a code lasts, from `CODE_TTL_MINUTES` — see GuestSignIn. */
  codeMinutes: string;
  /** Whether this journal keeps a guest list at all. Resolved on the server;
   * `isEnabled` reads server config and this file is a client component. */
  contactsEnabled: boolean;
  /**
   * What to call the person whose journal this is — one word, and never their
   * address (B20).
   *
   * Picked at the server boundary by `ownerShortName`, so this component is
   * handed a name and cannot reach the email sitting beside it in the config.
   * Absent when the journal names nobody, and the copy then falls back to the
   * sentences that name no one, because "Ask ." is worse than "ask them".
   */
  ownerName?: string;
  /**
   * Why they landed here rather than inside the journal (B142).
   *
   * `?signin=expired` has been redirected to for as long as the sign-in link
   * has existed, and until now nothing on this page said anything about it —
   * so somebody whose welcome link had been spent by their own mail provider
   * arrived at an ordinary page with no explanation and every reason to think
   * they had done something wrong.
   */
  signinNotice?: string;
}) {
  const { t } = useI18n();
  const site = useSite();

  // One line beside each trip, saying why it is open to this reader. The
  // wording is `resolveViewer`'s answer and never this component's: the panel
  // computing anything of its own about access is B41.
  const reason: Record<Viewer["trips"][number]["through"], TranslationKey> = {
    public: "me.viaPublic",
    owner: "me.viaOwner",
    traveller: "me.viaTraveller",
    guest: "me.viaGuest",
  };

  return (
    <div className="min-h-screen">
      <PageHeader />
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-navy-900 sm:text-4xl">
          {t("me.title")}
        </h1>

        {/* First thing on the page, above the fold and above the sign-in
            control it tells them to use. It is the answer to the question they
            arrived with. */}
        {signinNotice && (
          <p
            role="status"
            className="mt-5 rounded-2xl border-l-4 border-yellow-400 bg-cream-100 py-4 pl-5 pr-4 text-lg leading-8 text-navy-900"
          >
            {t(signinNotice as never)}
          </p>
        )}

        {!viewer.email ? (
          <>
            <section className="mt-6 rounded-2xl border border-navy-200 bg-white p-5 sm:p-6">
              <h2 className="font-display text-xl font-semibold text-navy-900">
                {t("me.strangerTitle")}
              </h2>
              {/*
                Who to ask, by name.

                The page is written for the reader least comfortable with
                software here — somebody who opens the journal from a link in
                an email and, when she loses the email, has no way back in. It
                told her the only way in was to ask a person and never said
                which person, on a site she may have reached without knowing
                whose it is.

                The name and nothing else. No address, no phone number: the
                same discipline the trip gate keeps (B117) — say enough that
                somebody who should be here knows who to write to, and nothing
                that would be a leak to whoever else tries the URL.
              */}
              <p className="mt-2 text-lg leading-8 text-navy-700">
                {ownerName
                  ? t("me.strangerBodyNamed", { name: ownerName })
                  : t("me.strangerBody")}
              </p>

              {/*
                There is exactly one door for a stranger, and it is signing in
                — which only works for somebody already known here.

                This page used to offer the open guestbook beside it: a form
                anybody who found the address could fill in, putting themselves
                on the owner's queue uninvited (B37). It is gone, and the
                sentence that used to appear only on journals with no guestbook
                is now the honest answer for every journal: the link somebody
                sends you is what lets you in.

                It is shown only when there is nothing to press. With sign-in
                available, the reader is offered that and nothing else —
                somebody reading this has almost certainly been here before and
                lost the email, and a second paragraph telling them to ask for
                a link would talk them out of the control right underneath it.
              */}
              {!canSignIn && (
                <p className="mt-4 border-l-2 border-yellow-400 pl-4 text-base leading-7 text-navy-900">
                  {ownerName ? t("me.askOwnerNamed", { name: ownerName }) : t("me.askOwner")}
                </p>
              )}
            </section>

            {/* The way back for somebody who has been here before and lost the
                email they were let in with. */}
            {canSignIn && <GuestSignIn username={username} codeMinutes={codeMinutes} />}
          </>
        ) : (
          <p className="mt-2 text-base text-navy-600">
            {t("me.signedInAs")}{" "}
            <strong className="font-semibold text-navy-900">{viewer.name ?? viewer.email}</strong>
          </p>
        )}

        {viewer.email && (
          <section className="mt-6">
            <h2 className="font-display text-xl font-semibold text-navy-900">{t("me.canRead")}</h2>
            {/*
              Two empty states, because there are two people who can reach one.

              For a guest it means the invitation has not arrived, and the
              answer is to ask whoever sent them. Said to the **owner** of a
              journal with no trips in it yet, that is nonsense — nobody sent
              them, and there is nothing to be invited to (B75).

              `resolveViewer` puts every trip in the journal into the list for
              an owner, so an empty list has exactly one meaning for them: the
              journal has no trips. The answer is how one gets made — an agent,
              per decision 24 — and the two lines to hand it are already in the
              owner block below, so the copy points down the page rather than
              repeating the handover here.
            */}
            {viewer.trips.length === 0 ? (
              <p className="mt-2 text-lg leading-8 text-navy-700">
                {t(viewer.owner ? "me.ownerNoTrips" : "me.nothing")}
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-navy-200 overflow-hidden rounded-2xl border border-navy-200 bg-white">
                {viewer.trips.map((trip) => (
                  <li key={trip.id}>
                    <Link
                      href={trip.href}
                      className="flex min-h-14 flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-4 py-3 transition-colors hover:bg-cream-50"
                    >
                      <span className="font-display text-lg font-semibold text-navy-900">
                        {trip.title}
                      </span>
                      <span className="text-sm text-navy-600">{t(reason[trip.through])}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {manageHref && (
          <section className="mt-6">
            <h2 className="font-display text-xl font-semibold text-navy-900">{t("me.details")}</h2>
            <p className="mt-2 text-lg leading-8 text-navy-700">{t("me.detailsBody")}</p>
            <Link
              href={manageHref}
              className="mt-3 inline-flex min-h-11 items-center rounded-full border border-navy-700 px-5 text-base font-semibold text-navy-900 transition-colors hover:bg-cream-100"
            >
              {t("me.editDetails")}
            </Link>
          </section>
        )}

        {viewer.owner && (
          <section className="mt-6 rounded-2xl border border-navy-200 bg-cream-100 p-5 sm:p-6">
            <h2 className="font-display text-xl font-semibold text-navy-900">
              {t("me.ownerTitle")}
            </h2>
            {/* Shared with the empty trip list, which is where a new owner
                actually lands first — see components/AgentHandover.tsx. */}
            <div className="mt-4">
              <AgentHandover docUrl={docUrl} email={viewer.email} />
            </div>
            {/*
              What the code actually becomes.
              
              The panel handed over an address and an email and stopped there,
              so the one thing a person needs to judge before reading a code
              aloud — what the other end can then do, and for how long — was
              written down nowhere they would look. The last line is decision
              24 in a sentence: reading the site on your phone must not put a
              credential that can rewrite it in your pocket, and the two are
              not interchangeable.
            */}
            <h3 className="mt-5 font-display text-base font-semibold text-navy-900">
              {t("me.tokenTitle")}
            </h3>
            <p className="mt-1 text-base leading-7 text-navy-700">{t("me.tokenBody")}</p>
            <p className="mt-2 border-l-2 border-coral-600 pl-3 text-base leading-7 text-navy-900">
              {t("me.tokenWarning")}
            </p>

            {/*
              The door for people — B79, and one door rather than two since
              B282.

              This block used to *make* a reading link, with `InviteLinks`, and
              then link to the page where links are listed, revoked and — since
              B280 — sent again. So the one control here produced something
              this page could not show you: the URL appeared once and was
              unrecoverable the moment the owner navigated away. Creation moved
              to the contacts panel (B281), which is where the note, the
              language and the copy button are, and this is a button that leads
              there.

              Gated on the same capability as before, and not on a new one:
              `/{user}/contacts` answers 404 unless `isEnabled("contacts", …)`,
              because a redemption has to land in the owner's queue and a
              journal with contacts off has no queue. Absent rather than
              disabled — B74 — since a greyed control explaining an operator
              switch is noise.
            */}
            {contactsEnabled && (
              <>
                <h3 className="mt-5 font-display text-base font-semibold text-navy-900">
                  {t("me.peopleTitle")}
                </h3>
                <p className="mt-1 text-base leading-7 text-navy-700">{t("me.peopleBody")}</p>
                <Link
                  href={`${site.base}/contacts`}
                  className="mt-3 inline-flex min-h-11 items-center rounded-full bg-yellow-400 px-5 text-base font-semibold text-yellow-950 transition-colors hover:bg-yellow-300"
                >
                  {t("me.contacts")}
                </Link>
              </>
            )}
          </section>
        )}

        {/*
          Last on the page, and only when there is a session to end.

          `viewer.email` is set from the guest cookie and from nothing else, so
          it is exactly the right condition: an owner reading their own journal
          without a session, or a guest following a link token, has nothing to
          sign out of and is not offered a control that would do nothing.
        */}
        {viewer.email && <SignOut />}
      </main>
    </div>
  );
}
